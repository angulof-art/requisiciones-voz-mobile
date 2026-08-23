export const EMAIL_PERMISSIONS = Object.freeze({
  send: "email.send",
  manageRecipients: "email.recipients.manage",
  manageGroups: "email.groups.manage",
  sendExternal: "email.send_external",
  readAudit: "email.audit.read"
});

export function hasEmailPermission(context, permission) {
  return Boolean(context?.permissions?.includes(permission));
}

export function canManageEmailDistribution(context) {
  return hasEmailPermission(context, EMAIL_PERMISSIONS.manageRecipients)
    || hasEmailPermission(context, EMAIL_PERMISSIONS.manageGroups);
}

export function emailPermissionMatrix() {
  return Object.freeze({
    administrator: Object.values(EMAIL_PERMISSIONS),
    manager: [EMAIL_PERMISSIONS.send, EMAIL_PERMISSIONS.manageGroups, EMAIL_PERMISSIONS.readAudit],
    requester: [EMAIL_PERMISSIONS.send],
    receiver: []
  });
}
