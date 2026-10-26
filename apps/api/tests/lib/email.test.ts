import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  escapeHtml,
  textToHtml,
  safeUrl,
  escapeTemplateParams,
  sanitizeSubject,
  sendEmail,
  EmailSendError,
  __setResendClientForTests,
} from '../../src/lib/email.js';
import { sendSms, SmsSendError, __setTwilioClientForTests } from '../../src/lib/sms.js';

describe('escaping helpers', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml('<script>alert("x")</script> & \'q\'')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;',
    );
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });

  it('textToHtml escapes and keeps line breaks', () => {
    expect(textToHtml('a<b>\nline 2')).toBe('a&lt;b&gt;<br>line 2');
  });

  it('safeUrl only allows http(s)', () => {
    expect(safeUrl('https://portal.example.com/invoices/1?a=1&b=2')).toBe(
      'https://portal.example.com/invoices/1?a=1&amp;b=2',
    );
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,hi')).toBe('#');
    expect(safeUrl(undefined)).toBe('#');
  });

  it('escapeTemplateParams escapes strings, validates url keys, keeps non-strings', () => {
    const out = escapeTemplateParams(
      { name: '<b>Bob</b>', url: 'javascript:x', n: 5 },
      ['url'],
    );
    expect(out).toEqual({ name: '&lt;b&gt;Bob&lt;/b&gt;', url: '#', n: 5 });
  });

  it('sanitizeSubject strips header-injection newlines', () => {
    expect(sanitizeSubject('Hello\r\nBcc: victim@example.com')).toBe('Hello Bcc: victim@example.com');
  });
});

describe('sendEmail', () => {
  const prevKey = process.env.RESEND_API_KEY;
  afterEach(() => {
    __setResendClientForTests(null);
    process.env.RESEND_API_KEY = prevKey;
  });

  it('throws a permanent EmailSendError when no API key is configured', async () => {
    delete process.env.RESEND_API_KEY;
    __setResendClientForTests(null);
    await expect(sendEmail({ to: 'a@b.c', subject: 's', html: 'h' })).rejects.toMatchObject({
      name: 'EmailSendError',
      permanent: true,
    });
  });

  it('throws (retryable) on a provider error instead of returning null', async () => {
    __setResendClientForTests({
      emails: { send: async () => ({ data: null, error: { name: 'rate_limit_exceeded', message: 'slow down' } }) },
    });
    const err = await sendEmail({ to: 'a@b.c', subject: 's', html: 'h' }).catch((e) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.permanent).toBe(false);
  });

  it('marks validation errors as permanent', async () => {
    __setResendClientForTests({
      emails: { send: async () => ({ data: null, error: { name: 'validation_error', message: 'bad to' } }) },
    });
    await expect(sendEmail({ to: 'bad', subject: 's', html: 'h' })).rejects.toMatchObject({ permanent: true });
  });

  it('throws on network failures', async () => {
    __setResendClientForTests({
      emails: { send: async () => { throw new Error('ECONNRESET'); } },
    });
    await expect(sendEmail({ to: 'a@b.c', subject: 's', html: 'h' })).rejects.toThrow(/ECONNRESET/);
  });

  it('returns the message id on success', async () => {
    __setResendClientForTests({ emails: { send: async () => ({ data: { id: 'msg_1' }, error: null }) } });
    await expect(sendEmail({ to: 'a@b.c', subject: 's', html: 'h' })).resolves.toBe('msg_1');
  });
});

describe('sendSms', () => {
  beforeEach(() => {
    process.env.TWILIO_DEFAULT_NUMBER = '+15550000000';
  });
  afterEach(() => {
    __setTwilioClientForTests(null);
    delete process.env.TWILIO_DEFAULT_NUMBER;
  });

  it('throws instead of swallowing Twilio errors', async () => {
    __setTwilioClientForTests({
      messages: { create: async () => { throw Object.assign(new Error('timeout'), { code: 20500 }); } },
    });
    const err = await sendSms('+15551112222', 'hi').catch((e) => e);
    expect(err).toBeInstanceOf(SmsSendError);
    expect(err.permanent).toBe(false);
  });

  it('marks STOP-unsubscribed recipients (21610) as permanent', async () => {
    __setTwilioClientForTests({
      messages: { create: async () => { throw Object.assign(new Error('unsubscribed'), { code: 21610 }); } },
    });
    await expect(sendSms('+15551112222', 'hi')).rejects.toMatchObject({ permanent: true });
  });

  it('throws a permanent error when no from-number is configured', async () => {
    delete process.env.TWILIO_DEFAULT_NUMBER;
    await expect(sendSms('+15551112222', 'hi')).rejects.toMatchObject({ permanent: true });
  });

  it('returns the SID on success', async () => {
    __setTwilioClientForTests({ messages: { create: async () => ({ sid: 'SM1' }) } });
    await expect(sendSms('+15551112222', 'hi')).resolves.toBe('SM1');
  });
});
