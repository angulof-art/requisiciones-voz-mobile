const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function parseSendRequest(value: unknown) {
  if (!value || typeof value !== "object") throw new HttpError(400, "invalid_request", "Solicitud invalida.");
  const input = value as Record<string, unknown>;
  const requisitionId = clean(input.requisitionId, 180);
  const distributionGroupId = clean(input.distributionGroupId, 80) || null;
  const recipientSelections = parseRecipientSelections(input.recipientSelections ?? input.recipientIds);
  const recipientIds = recipientSelections.map((entry) => entry.id);
  const itemIds = uniqueStrings(input.itemIds, 200);
  const customNote = cleanMultiline(input.customNote, 2000);
  const eventName = clean(input.eventName, 160);
  const clientOperationId = clean(input.clientOperationId, 120);
  const expectedRevision = Number(input.expectedRevision);
  const forceResend = input.forceResend === true;
  const externalRecipients = parseExternalRecipients(input.externalRecipients);
  if (!requisitionId || !requisitionId.startsWith("req-")) {
    throw new HttpError(400, "invalid_requisition", "La requisicion no es valida.");
  }
  if (!clientOperationId || !/^[a-zA-Z0-9-]{16,120}$/.test(clientOperationId)) {
    throw new HttpError(400, "invalid_operation", "La operacion de envio no es valida.");
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new HttpError(400, "invalid_revision", "La revision no es valida.");
  }
  return { requisitionId, distributionGroupId, recipientIds, recipientSelections, itemIds, externalRecipients, customNote, eventName, clientOperationId, expectedRevision, forceResend };
}

export function normalizeEmail(value: unknown) {
  return clean(value, 254).toLowerCase();
}

export function validEmail(value: unknown) {
  return EMAIL_PATTERN.test(normalizeEmail(value));
}

export function stripHeaderBreaks(value: unknown, limit = 240) {
  return clean(value, limit).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

export function safeErrorResponse(error: unknown) {
  if (error instanceof HttpError) return { status: error.status, body: { error: error.message, code: error.code } };
  return { status: 500, body: { error: "No se pudo procesar el envio.", code: "email_send_failed" } };
}

function parseExternalRecipients(value: unknown) {
  if (!Array.isArray(value)) return [];
  if (value.length > 25) throw new HttpError(400, "too_many_external", "Hay demasiados correos externos.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new HttpError(400, "invalid_external", "Correo externo invalido.");
    const record = entry as Record<string, unknown>;
    const email = normalizeEmail(record.email);
    if (!validEmail(email)) throw new HttpError(400, "invalid_external", "Correo externo invalido.");
    return { id: null, name: clean(record.name, 120) || email, email, deliveryType: deliveryType(record.deliveryType) };
  });
}

function uniqueStrings(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  const result = [...new Set(value.map((entry) => clean(entry, 80)).filter(Boolean))];
  if (result.length > limit) throw new HttpError(400, "too_many_recipients", "Hay demasiados destinatarios.");
  return result;
}

function parseRecipientSelections(value: unknown) {
  if (!Array.isArray(value)) return [];
  if (value.length > 50) throw new HttpError(400, "too_many_recipients", "Hay demasiados destinatarios.");
  const selections = value.map((entry) => {
    if (typeof entry === "string") return { id: clean(entry, 80), deliveryType: "to" };
    if (!entry || typeof entry !== "object") throw new HttpError(400, "invalid_recipient", "Destinatario invalido.");
    const record = entry as Record<string, unknown>;
    return { id: clean(record.id, 80), deliveryType: deliveryType(record.deliveryType) };
  }).filter((entry) => entry.id);
  const unique = new Map(selections.map((entry) => [entry.id, entry]));
  return [...unique.values()];
}

function deliveryType(value: unknown) {
  return ["to", "cc", "bcc"].includes(String(value)) ? String(value) : "to";
}

function clean(value: unknown, limit: number) {
  return String(value || "").trim().slice(0, limit);
}

function cleanMultiline(value: unknown, limit: number) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, limit);
}
