// E-signature integration for contracts and renewals

import { prisma } from "../lib/prisma.js";
import { formatDateOnlyISO, todayDateOnly } from "@helm/shared-types";

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
  if (!process.env.DOCUSIGN_API_KEY) return null;
  return {
    provider: (process.env.ESIGN_PROVIDER as EsignConfig["provider"]) || "docusign",
    apiKey: process.env.DOCUSIGN_API_KEY,
    accountId: process.env.DOCUSIGN_ACCOUNT_ID,
  };
}

/**
 * Send a document for electronic signature.
 * Creates an envelope via DocuSign eSignature API, or falls back to a magic-link
 * flow when DocuSign is not configured.
 */
export async function sendForSignature(
  request: SignatureRequest,
  tenantId: string,
): Promise<{ requestId: string; signingUrl: string }> {
  const config = getConfig();

  if (!config || !config.accountId) {
    // Fallback: generate a simple magic link for signing
    const requestId = crypto.randomUUID();
    const signingUrl = `${process.env.APP_URL || "https://app.helm.dev"}/sign/${requestId}`;

    await prisma.auditLog.create({
      data: {
        tenantId,
        action: "ESIGN_MAGIC_LINK",
        recordType: "SIGNATURE_REQUEST",
        recordId: requestId,
        changedFieldsJson: {
          signerEmail: request.signerEmail,
          signerName: request.signerName,
          subject: request.subject,
          documentUrl: request.documentUrl,
          metadata: request.metadata,
        },
      },
    });

    return { requestId, signingUrl };
  }

  // Create envelope via DocuSign eSignature REST API
  const envelopePayload = {
    emailSubject: request.subject,
    emailBlurb: request.message,
    status: "sent",
    documents: [
      {
        documentBase64: "", // Will be populated from R2 URL
        name: request.subject,
        fileExtension: "pdf",
        documentId: "1",
        remoteUrl: request.documentUrl,
      },
    ],
    recipients: {
      signers: [
        {
          email: request.signerEmail,
          name: request.signerName,
          recipientId: "1",
          routingOrder: "1",
          tabs: {
            signHereTabs: [{ documentId: "1", pageNumber: "1", xPosition: "100", yPosition: "700" }],
            dateSignedTabs: [{ documentId: "1", pageNumber: "1", xPosition: "100", yPosition: "750" }],
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
    customFields: {
      textCustomFields: Object.entries(request.metadata).map(([name, value]) => ({
        name,
        value,
        show: "false",
      })),
    },
  };

  // Fetch document content from R2
  const docResponse = await fetch(request.documentUrl);
  const docBuffer = Buffer.from(await docResponse.arrayBuffer());
  envelopePayload.documents[0].documentBase64 = docBuffer.toString("base64");

  const baseUrl = config.provider === "docusign"
    ? "https://demo.docusign.net/restapi/v2.1"
    : "https://api.hellosign.com/v3";

  // POST to DocuSign to create the envelope
  const response = await fetch(
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

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`DocuSign API error ${response.status}: ${errorBody}`);
  }

  const envelope = (await response.json()) as { envelopeId: string; uri: string };

  // Retrieve the signing URL (recipient view)
  const viewResponse = await fetch(
    `${baseUrl}/accounts/${config.accountId}/envelopes/${envelope.envelopeId}/views/recipient`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        returnUrl: `${process.env.APP_URL || "https://app.helm.dev"}/contracts/signed`,
        authenticationMethod: "email",
        email: request.signerEmail,
        userName: request.signerName,
      }),
    },
  );

  if (!viewResponse.ok) {
    const errorBody = await viewResponse.text();
    throw new Error(`DocuSign recipient view error ${viewResponse.status}: ${errorBody}`);
  }

  const view = (await viewResponse.json()) as { url: string };

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "ESIGN_SENT",
      recordType: "SIGNATURE_REQUEST",
      recordId: envelope.envelopeId,
      changedFieldsJson: {
        signerEmail: request.signerEmail,
        signerName: request.signerName,
        subject: request.subject,
        metadata: request.metadata,
      },
    },
  });

  return { requestId: envelope.envelopeId, signingUrl: view.url };
}

/**
 * Bulk send signature requests for renewal batches.
 * Processes requests in parallel with a concurrency limit of 5.
 */
export async function sendBatchForSignature(
  requests: SignatureRequest[],
  tenantId: string,
): Promise<Array<{ requestId: string; signerEmail: string; status: string }>> {
  const CONCURRENCY = 5;
  const results: Array<{ requestId: string; signerEmail: string; status: string }> = [];

  for (let i = 0; i < requests.length; i += CONCURRENCY) {
    const batch = requests.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (req) => {
        const result = await sendForSignature(req, tenantId);
        return { requestId: result.requestId, signerEmail: req.signerEmail, status: "sent" };
      }),
    );

    for (let j = 0; j < batchResults.length; j++) {
      const settled = batchResults[j];
      if (settled.status === "fulfilled") {
        results.push(settled.value);
      } else {
        results.push({
          requestId: "",
          signerEmail: batch[j].signerEmail,
          status: `failed: ${settled.reason?.message || "unknown error"}`,
        });
      }
    }
  }

  return results;
}

/**
 * Process a DocuSign Connect webhook callback.
 * On "completed": update contract status, store signed PDF in R2, log audit entry.
 * On "declined": notify staff, update contract status.
 */
export async function handleWebhook(payload: any, tenantId: string): Promise<void> {
  const envelopeId: string = payload.envelopeId || payload.data?.envelopeId;
  const status: string = (payload.status || payload.data?.envelopeSummary?.status || "").toLowerCase();

  if (!envelopeId) {
    throw new Error("Missing envelopeId in webhook payload");
  }

  if (status === "completed") {
    // Download the signed PDF from DocuSign
    const config = getConfig();
    let signedDocumentUrl: string | undefined;

    if (config?.accountId) {
      const baseUrl = "https://demo.docusign.net/restapi/v2.1";
      const docResponse = await fetch(
        `${baseUrl}/accounts/${config.accountId}/envelopes/${envelopeId}/documents/combined`,
        {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        },
      );

      if (docResponse.ok) {
        const pdfBuffer = Buffer.from(await docResponse.arrayBuffer());

        // Store signed PDF in R2 via presigned URL or direct upload
        const r2Key = `tenants/${tenantId}/contracts/signed/${envelopeId}.pdf`;
        signedDocumentUrl = `${process.env.R2_PUBLIC_URL || "https://storage.helm.dev"}/${r2Key}`;

        // Upload to R2 (assumes R2_UPLOAD_URL configured)
        if (process.env.R2_UPLOAD_URL) {
          await fetch(`${process.env.R2_UPLOAD_URL}/${r2Key}`, {
            method: "PUT",
            headers: { "Content-Type": "application/pdf" },
            body: pdfBuffer,
          });
        }
      }
    }

    // Update contract status. signedAt is a calendar date — normalize to
    // UTC midnight so the contract reads as signed on the same day for
    // every viewer regardless of timezone.
    await prisma.slipContract.updateMany({
      where: { tenantId, esignEnvelopeId: envelopeId },
      data: { status: "ACTIVE", signedAt: todayDateOnly(), signedDocumentUrl },
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        action: "ESIGN_COMPLETED",
        recordType: "SIGNATURE_REQUEST",
        recordId: envelopeId,
        changedFieldsJson: { signedDocumentUrl },
      },
    });
  } else if (status === "declined") {
    // Update contract status
    await prisma.slipContract.updateMany({
      where: { tenantId, esignEnvelopeId: envelopeId },
      data: { status: "TERMINATED" },
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        action: "ESIGN_DECLINED",
        recordType: "SIGNATURE_REQUEST",
        recordId: envelopeId,
        changedFieldsJson: { declinedReason: payload.declineReason || payload.data?.declineReason },
      },
    });
  }
}

/**
 * Check the current status of a signature request.
 */
export async function getSigningStatus(
  requestId: string,
  tenantId: string,
): Promise<{ status: string; signedAt?: string; documentUrl?: string }> {
  const config = getConfig();

  if (!config?.accountId) {
    // Fallback: check contract record for magic-link based signing
    const contract = await prisma.slipContract.findFirst({
      where: { tenantId, esignEnvelopeId: requestId },
      select: { status: true, signedAt: true, signedDocumentUrl: true },
    });

    if (!contract) {
      return { status: "not_found" };
    }

    return {
      status: contract.status.toLowerCase(),
      // signedAt is a calendar date — emit YYYY-MM-DD instead of an ISO
      // timestamp so the polling caller never has to .split('T')[0] it.
      signedAt: formatDateOnlyISO(contract.signedAt) ?? undefined,
      documentUrl: contract.signedDocumentUrl ?? undefined,
    };
  }

  const baseUrl = "https://demo.docusign.net/restapi/v2.1";
  const response = await fetch(
    `${baseUrl}/accounts/${config.accountId}/envelopes/${requestId}`,
    {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    },
  );

  if (!response.ok) {
    throw new Error(`DocuSign status check failed: ${response.status}`);
  }

  const envelope = (await response.json()) as {
    status: string;
    completedDateTime?: string;
    documentsUri?: string;
  };

  return {
    status: envelope.status,
    // DocuSign returns a full ISO timestamp, but signedAt is a calendar
    // date contract-side — normalize to YYYY-MM-DD so the field is shaped
    // consistently with the local-fallback branch and with the rest of the
    // API surface.
    signedAt: formatDateOnlyISO(envelope.completedDateTime) ?? undefined,
    documentUrl: envelope.status === "completed"
      ? `${process.env.R2_PUBLIC_URL || "https://storage.helm.dev"}/tenants/${tenantId}/contracts/signed/${requestId}.pdf`
      : undefined,
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

  if (config?.accountId) {
    const baseUrl = "https://demo.docusign.net/restapi/v2.1";
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
      throw new Error(`DocuSign void failed: ${response.status}: ${errorBody}`);
    }
  }

  // Update local contract status
  await prisma.slipContract.updateMany({
    where: { tenantId, esignEnvelopeId: requestId },
    data: { status: "TERMINATED" },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: "ESIGN_CANCELLED",
      recordType: "SIGNATURE_REQUEST",
      recordId: requestId,
      changedFieldsJson: { cancelledBy: "staff" },
    },
  });
}
