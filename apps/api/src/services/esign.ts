// E-signature integration for contracts and renewals

import { prisma } from "../lib/prisma.js";

interface EsignConfig {
  provider: "docusign" | "hellosign";
  apiKey: string;
  accountId?: string;
}

interface SignatureRequest {
  documentUrl: string; // R2 URL of the contract PDF
  signerName: string;
  signerEmail: string;
  subject: string;
  message: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}

function getConfig(): EsignConfig | null {
  if (!process.env.ESIGN_API_KEY) return null;
  return {
    provider: (process.env.ESIGN_PROVIDER as "docusign" | "hellosign") || "docusign",
    apiKey: process.env.ESIGN_API_KEY,
    accountId: process.env.ESIGN_ACCOUNT_ID,
  };
}

/**
 * Create a signature request via DocuSign eSignature API.
 * POST to https://demo.docusign.net/restapi/v2.1/accounts/{accountId}/envelopes
 * Includes document, signer info, and webhook callback.
 * Returns the envelope ID and signing URL.
 * Fallback: If DocuSign not configured, generate a simple magic link.
 */
export async function sendForSignature(
  request: SignatureRequest,
  tenantId: string,
): Promise<{ requestId: string; signingUrl: string }> {
  const config = getConfig();

  if (!config) {
    // Fallback: generate a simple magic link for signing
    const token = crypto.randomUUID();
    await prisma.signatureRequest.create({
      data: {
        tenantId,
        requestId: token,
        documentUrl: request.documentUrl,
        signerName: request.signerName,
        signerEmail: request.signerEmail,
        subject: request.subject,
        message: request.message,
        callbackUrl: request.callbackUrl,
        metadata: request.metadata,
        status: "PENDING",
      },
    });
    const signingUrl = `${process.env.APP_URL}/sign/${token}`;
    return { requestId: token, signingUrl };
  }

  const baseUrl =
    process.env.DOCUSIGN_BASE_URL ||
    "https://demo.docusign.net/restapi/v2.1";

  // Create the envelope with document and signer
  const envelopePayload = {
    emailSubject: request.subject,
    emailBlurb: request.message,
    status: "sent",
    documents: [
      {
        documentBase64: "", // Will be fetched from R2
        name: request.subject,
        fileExtension: "pdf",
        documentId: "1",
        uri: request.documentUrl,
      },
    ],
    recipients: {
      signers: [
        {
          email: request.signerEmail,
          name: request.signerName,
          recipientId: "1",
          routingOrder: "1",
          clientUserId: tenantId, // For embedded signing
          tabs: {
            signHereTabs: [
              { documentId: "1", pageNumber: "1", xPosition: "100", yPosition: "700" },
            ],
          },
        },
      ],
    },
    eventNotification: {
      url: request.callbackUrl,
      loggingEnabled: true,
      requireAcknowledgment: true,
      envelopeEvents: [
        { envelopeEventStatusCode: "completed" },
        { envelopeEventStatusCode: "declined" },
        { envelopeEventStatusCode: "voided" },
      ],
    },
  };

  // Fetch document content from R2
  const docResponse = await fetch(request.documentUrl);
  const docBuffer = await docResponse.arrayBuffer();
  envelopePayload.documents[0].documentBase64 =
    Buffer.from(docBuffer).toString("base64");

  // Create envelope via DocuSign API
  const envelopeResponse = await fetch(
    `${baseUrl}/accounts/${config.accountId}/envelopes`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelopePayload),
    },
  );

  if (!envelopeResponse.ok) {
    const errorBody = await envelopeResponse.text();
    throw new Error(
      `DocuSign envelope creation failed: ${envelopeResponse.status} ${errorBody}`,
    );
  }

  const envelope = (await envelopeResponse.json()) as { envelopeId: string };
  const envelopeId = envelope.envelopeId;

  // Get the recipient signing URL (embedded signing)
  const viewResponse = await fetch(
    `${baseUrl}/accounts/${config.accountId}/envelopes/${envelopeId}/views/recipient`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        returnUrl: `${process.env.APP_URL}/signing-complete`,
        authenticationMethod: "none",
        email: request.signerEmail,
        userName: request.signerName,
        clientUserId: tenantId,
      }),
    },
  );

  if (!viewResponse.ok) {
    const errorBody = await viewResponse.text();
    throw new Error(
      `DocuSign signing URL failed: ${viewResponse.status} ${errorBody}`,
    );
  }

  const viewResult = (await viewResponse.json()) as { url: string };

  // Persist the signature request record
  await prisma.signatureRequest.create({
    data: {
      tenantId,
      requestId: envelopeId,
      documentUrl: request.documentUrl,
      signerName: request.signerName,
      signerEmail: request.signerEmail,
      subject: request.subject,
      message: request.message,
      callbackUrl: request.callbackUrl,
      metadata: request.metadata,
      status: "SENT",
    },
  });

  return { requestId: envelopeId, signingUrl: viewResult.url };
}

/**
 * Bulk send for renewal batches - send each in parallel with concurrency limit of 5.
 */
export async function sendBatchForSignature(
  requests: SignatureRequest[],
  tenantId: string,
): Promise<Array<{ requestId: string; signerEmail: string; status: string }>> {
  const concurrencyLimit = 5;
  const results: Array<{ requestId: string; signerEmail: string; status: string }> = [];

  // Process in chunks of concurrencyLimit
  for (let i = 0; i < requests.length; i += concurrencyLimit) {
    const chunk = requests.slice(i, i + concurrencyLimit);
    const chunkResults = await Promise.allSettled(
      chunk.map(async (request) => {
        const result = await sendForSignature(request, tenantId);
        return {
          requestId: result.requestId,
          signerEmail: request.signerEmail,
          status: "sent",
        };
      }),
    );

    for (let j = 0; j < chunkResults.length; j++) {
      const settled = chunkResults[j];
      if (settled.status === "fulfilled") {
        results.push(settled.value);
      } else {
        results.push({
          requestId: "",
          signerEmail: chunk[j].signerEmail,
          status: `failed: ${settled.reason?.message || "unknown error"}`,
        });
      }
    }
  }

  return results;
}

/**
 * Process DocuSign Connect webhook.
 * On "completed": update contract status, store signed PDF in R2, log audit entry.
 * On "declined": notify staff, update contract status.
 */
export async function handleWebhook(
  payload: any,
  tenantId: string,
): Promise<void> {
  const envelopeId = payload.envelopeId || payload.data?.envelopeId;
  const status = (
    payload.status ||
    payload.event ||
    payload.data?.envelopeSummary?.status ||
    ""
  ).toLowerCase();

  const sigRequest = await prisma.signatureRequest.findFirst({
    where: { tenantId, requestId: envelopeId },
  });

  if (!sigRequest) {
    console.warn(`Signature request not found for envelope ${envelopeId}`);
    return;
  }

  if (status === "completed") {
    // Update the signature request status
    await prisma.signatureRequest.update({
      where: { id: sigRequest.id },
      data: { status: "COMPLETED", signedAt: new Date() },
    });

    // Fetch signed PDF from DocuSign and store in R2
    const config = getConfig();
    if (config) {
      const baseUrl =
        process.env.DOCUSIGN_BASE_URL ||
        "https://demo.docusign.net/restapi/v2.1";
      const docResponse = await fetch(
        `${baseUrl}/accounts/${config.accountId}/envelopes/${envelopeId}/documents/combined`,
        {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        },
      );

      if (docResponse.ok) {
        const signedPdf = await docResponse.arrayBuffer();
        const r2Key = `signed-contracts/${tenantId}/${envelopeId}.pdf`;

        // Upload to R2 via internal upload endpoint
        await fetch(`${process.env.R2_UPLOAD_URL}/${r2Key}`, {
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
          body: signedPdf,
        });

        await prisma.signatureRequest.update({
          where: { id: sigRequest.id },
          data: { signedDocumentUrl: `${process.env.R2_PUBLIC_URL}/${r2Key}` },
        });
      }
    }

    // Update related contract status if metadata contains contractId
    const contractId = (sigRequest.metadata as any)?.contractId;
    if (contractId) {
      await prisma.contract.update({
        where: { id: contractId },
        data: { status: "ACTIVE", signedAt: new Date() },
      });
    }

    // Log audit entry
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: "ESIGN_COMPLETED",
        recordType: "SignatureRequest",
        recordId: sigRequest.id,
        details: { envelopeId, signerEmail: sigRequest.signerEmail },
      },
    });
  } else if (status === "declined") {
    await prisma.signatureRequest.update({
      where: { id: sigRequest.id },
      data: { status: "DECLINED" },
    });

    // Update related contract status
    const contractId = (sigRequest.metadata as any)?.contractId;
    if (contractId) {
      await prisma.contract.update({
        where: { id: contractId },
        data: { status: "DECLINED" },
      });
    }

    // Log audit entry
    await prisma.auditLog.create({
      data: {
        tenantId,
        action: "ESIGN_DECLINED",
        recordType: "SignatureRequest",
        recordId: sigRequest.id,
        details: { envelopeId, signerEmail: sigRequest.signerEmail },
      },
    });

    // Notify staff (via internal notification system)
    await prisma.notification.create({
      data: {
        tenantId,
        type: "ESIGN_DECLINED",
        title: `E-signature declined: ${sigRequest.subject}`,
        body: `${sigRequest.signerName} (${sigRequest.signerEmail}) declined to sign "${sigRequest.subject}".`,
        channel: "DASHBOARD",
      },
    });
  }
}

/**
 * Check status of a signature request.
 */
export async function getSigningStatus(
  requestId: string,
  tenantId: string,
): Promise<{ status: string; signedAt?: string; documentUrl?: string }> {
  const config = getConfig();

  // First check local DB
  const sigRequest = await prisma.signatureRequest.findFirst({
    where: { tenantId, requestId },
  });

  if (!sigRequest) {
    throw new Error(`Signature request ${requestId} not found`);
  }

  // If we have a completed status locally, return it
  if (sigRequest.status === "COMPLETED" || sigRequest.status === "DECLINED") {
    return {
      status: sigRequest.status,
      signedAt: sigRequest.signedAt?.toISOString(),
      documentUrl: sigRequest.signedDocumentUrl ?? undefined,
    };
  }

  // Otherwise, check with DocuSign for the latest status
  if (config && config.accountId) {
    const baseUrl =
      process.env.DOCUSIGN_BASE_URL ||
      "https://demo.docusign.net/restapi/v2.1";

    const response = await fetch(
      `${baseUrl}/accounts/${config.accountId}/envelopes/${requestId}`,
      {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      },
    );

    if (response.ok) {
      const envelope = (await response.json()) as {
        status: string;
        completedDateTime?: string;
      };
      return {
        status: envelope.status,
        signedAt: envelope.completedDateTime,
      };
    }
  }

  return {
    status: sigRequest.status,
    signedAt: sigRequest.signedAt?.toISOString(),
    documentUrl: sigRequest.signedDocumentUrl ?? undefined,
  };
}

/**
 * Void/cancel a pending signature request.
 */
export async function cancelSignatureRequest(
  requestId: string,
  tenantId: string,
): Promise<void> {
  const config = getConfig();

  const sigRequest = await prisma.signatureRequest.findFirst({
    where: { tenantId, requestId },
  });

  if (!sigRequest) {
    throw new Error(`Signature request ${requestId} not found`);
  }

  if (sigRequest.status === "COMPLETED") {
    throw new Error("Cannot cancel a completed signature request");
  }

  // Void the envelope in DocuSign
  if (config && config.accountId) {
    const baseUrl =
      process.env.DOCUSIGN_BASE_URL ||
      "https://demo.docusign.net/restapi/v2.1";

    const response = await fetch(
      `${baseUrl}/accounts/${config.accountId}/envelopes/${requestId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "voided",
          voidedReason: "Cancelled by marina staff",
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `DocuSign void failed: ${response.status} ${errorBody}`,
      );
    }
  }

  // Update local record
  await prisma.signatureRequest.update({
    where: { id: sigRequest.id },
    data: { status: "VOIDED" },
  });

  // Log audit entry
  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "ESIGN_CANCELLED",
      recordType: "SignatureRequest",
      recordId: sigRequest.id,
      details: { requestId, signerEmail: sigRequest.signerEmail },
    },
  });
}
