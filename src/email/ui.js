import {
  buildCustomSelection,
  buildGroupSelection,
  detectDistributionSuggestions,
  hasRequisitionChangedSinceSend,
  isValidEmail,
  makeClientOperationId,
  normalizeCustomNote,
  recipientRoleLabel,
  setRecipientDeliveryType,
  setRecipientSelected,
  splitItemsByDistribution,
  validateDistribution
} from "./distribution.js?v=2.0.0-rc.1";
import { buildEmailPreview, escapeHtml } from "./preview.js?v=2.0.0-rc.1";
import {
  loadEmailConfiguration,
  loadEmailSendHistory,
  saveDistributionGroup,
  saveDistributionRule,
  saveEmailRecipient,
  saveEmailSettings,
  saveGroupRecipients,
  sendRequisitionEmail
} from "./api.js?v=2.0.0-rc.1";
import {
  EMAIL_PERMISSIONS,
  canManageEmailDistribution,
  hasEmailPermission
} from "./permissions.js?v=2.0.0-rc.1";

export function createEmailDistributionController(options) {
  const elements = collectElements();
  const model = {
    configuration: null,
    requisition: null,
    selections: new Map(),
    suggestions: { groups: [], mixed: false },
    externalRecipients: [],
    previews: [],
    sends: [],
    sending: false,
    operationIds: new Map()
  };

  bindEvents();

  return {
    open,
    renderCurrent,
    renderAdmin,
    canOffer: (requisition) => canOfferEmail(options.getContext(), requisition)
  };

  function bindEvents() {
    elements.emailButton.addEventListener("click", () => open(options.getCurrentRequisition()));
    elements.closeButton.addEventListener("click", closeDialog);
    elements.cancelButton.addEventListener("click", closeDialog);
    elements.backButton.addEventListener("click", showComposeStep);
    elements.previewButton.addEventListener("click", showPreviewStep);
    elements.sendButton.addEventListener("click", sendAll);
    elements.groupSelect.addEventListener("change", () => {
      const context = options.getContext();
      model.selections.clear();
      if (elements.groupSelect.value === "custom") {
        model.selections.set("custom", buildCustomSelection(model.configuration));
      } else {
        model.selections.set(elements.groupSelect.value, buildGroupSelection(model.configuration, elements.groupSelect.value));
      }
      model.operationIds.clear();
      renderCompose(context);
    });
    elements.recipientList.addEventListener("change", handleRecipientChange);
    elements.addExternalButton.addEventListener("click", addExternalRecipient);
    elements.externalList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-external]");
      if (!button) return;
      model.externalRecipients.splice(Number(button.dataset.removeExternal), 1);
      renderExternalRecipients();
    });
    elements.mixedOptions.addEventListener("change", () => {
      model.selections.clear();
      model.operationIds.clear();
      ensureSelectionsForMode();
      renderCompose(options.getContext());
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-email-requisition-id]");
      if (!button) return;
      const requisition = options.getRequisition(button.dataset.emailRequisitionId);
      if (requisition) open(requisition);
    });
    elements.adminRoot.addEventListener("submit", handleAdminSubmit);
    elements.adminRoot.addEventListener("click", handleAdminClick);
    elements.adminRoot.addEventListener("change", handleAdminChange);
  }

  function renderCurrent(requisition) {
    const context = options.getContext();
    const visible = canOfferEmail(context, requisition);
    elements.emailButton.hidden = !visible;
    elements.emailButton.disabled = !navigator.onLine || requisition?.syncStatus !== "synced";
    elements.emailButton.title = !navigator.onLine
      ? "El envio por correo necesita conexion."
      : requisition?.syncStatus !== "synced" ? "Sincronice el pedido antes de enviarlo por correo." : "";
  }

  async function open(requisition) {
    const context = options.getContext();
    if (!canOfferEmail(context, requisition)) return options.toast("Este pedido no esta listo para enviarse por correo.");
    if (!navigator.onLine) return options.toast("El envio por correo necesita conexion.");
    model.requisition = enrichRequisition(requisition, options.getCatalog());
    model.externalRecipients = [];
    model.previews = [];
    model.operationIds.clear();
    elements.featureNotice.hidden = true;
    elements.featureNotice.textContent = "";
    elements.composeStep.hidden = false;
    elements.previewStep.hidden = true;
    elements.previewButton.hidden = false;
    elements.sendButton.hidden = true;
    elements.backButton.hidden = true;
    elements.validationList.classList.remove("visible");
    elements.validationList.innerHTML = "";
    renderOrderSummary();
    openDialog(elements.dialog);
    try {
      [model.configuration, model.sends] = await Promise.all([
        loadEmailConfiguration(context.organizationId),
        loadEmailSendHistory(requisition.id)
      ]);
      renderHistory();
      if (!model.configuration.settings.enabled) {
        elements.featureNotice.textContent = "Envío por correo todavía no configurado.";
        elements.featureNotice.hidden = false;
        elements.composeStep.hidden = true;
        elements.previewButton.hidden = true;
        return;
      }
      configureGroups();
      configureSuggestions();
      ensureSelectionsForMode();
      renderCompose(context);
    } catch (error) {
      elements.featureNotice.textContent = friendlyError(error, "No se pudo cargar la distribucion por correo.");
      elements.featureNotice.hidden = false;
      elements.composeStep.hidden = true;
      elements.previewButton.hidden = true;
    }
  }

  function configureGroups() {
    const groups = model.configuration.groups;
    elements.groupSelect.innerHTML = [
      ...groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`),
      '<option value="custom">Personalizado</option>'
    ].join("");
    const suggested = model.suggestions.groups?.[0];
    elements.groupSelect.value = suggested?.id || groups[0]?.id || "custom";
  }

  function configureSuggestions() {
    model.suggestions = detectDistributionSuggestions(
      model.requisition.items,
      model.configuration.rules,
      model.configuration.groups
    );
    elements.mixedOptions.hidden = !model.suggestions.mixed;
    if (model.suggestions.groups[0]) elements.groupSelect.value = model.suggestions.groups[0].id;
  }

  function ensureSelectionsForMode() {
    const split = selectedMixedMode() === "split" && model.suggestions.mixed;
    if (split) {
      for (const group of model.suggestions.groups) {
        model.selections.set(group.id, buildGroupSelection(model.configuration, group.id));
      }
      return;
    }
    const groupId = elements.groupSelect.value;
    model.selections.set(groupId, groupId === "custom"
      ? buildCustomSelection(model.configuration)
      : buildGroupSelection(model.configuration, groupId));
  }

  function renderCompose(context) {
    renderRecipients();
    renderExternalRecipients();
    const single = [...model.selections.values()][0];
    elements.eventLabel.hidden = single?.group?.code !== "SPECIAL_EVENT";
    elements.externalBlock.hidden = !(
      model.selections.size === 1
      && model.configuration.settings.allow_external
      && hasEmailPermission(context, EMAIL_PERMISSIONS.sendExternal)
    );
  }

  function renderRecipients() {
    let count = 0;
    elements.recipientList.innerHTML = [...model.selections.entries()].map(([selectionKey, selection]) => {
      const rows = selection.recipients.map((recipient) => {
        if (recipient.selected) count += 1;
        return `<div class="email-recipient-row">
          <label>
            <input type="checkbox" data-email-selection="${escapeHtml(selectionKey)}" data-email-recipient="${escapeHtml(recipient.id)}" ${recipient.selected ? "checked" : ""} ${recipient.required ? "disabled" : ""} />
            <span><strong>${escapeHtml(recipient.name)}</strong><small>${escapeHtml(recipient.department_label || recipientRoleLabel(recipient.recipient_type))}${recipient.suggested ? " · Sugerido" : " · Otro disponible"}</small></span>
          </label>
          <select data-email-delivery="${escapeHtml(selectionKey)}" data-email-recipient="${escapeHtml(recipient.id)}" aria-label="Tipo de entrega para ${escapeHtml(recipient.name)}">
            ${["to", "cc", "bcc"].map((type) => `<option value="${type}" ${recipient.deliveryType === type ? "selected" : ""}>${type.toUpperCase()}</option>`).join("")}
          </select>
          ${recipient.required ? '<span class="email-lock" title="Destinatario requerido por la regla de distribucion">Requerido</span>' : ""}
        </div>`;
      }).join("");
      return `<section><h4>${escapeHtml(selection.group?.name || "Personalizado")}</h4>${rows || '<p class="hint">No hay destinatarios configurados para este grupo.</p>'}</section>`;
    }).join("");
    elements.recipientCount.textContent = String(count);
    elements.recipientHint.textContent = count
      ? "Revise los destinatarios y el tipo TO, CC o BCC."
      : "Faltan destinatarios configurados para esta distribucion.";
  }

  function handleRecipientChange(event) {
    const input = event.target;
    const recipientId = input.dataset.emailRecipient;
    if (!recipientId) return;
    const selectionKey = input.dataset.emailSelection || input.dataset.emailDelivery;
    const selection = model.selections.get(selectionKey);
    if (!selection) return;
    if (input.matches("[data-email-selection]")) {
      selection.recipients = setRecipientSelected(selection.recipients, recipientId, input.checked);
    } else {
      selection.recipients = setRecipientDeliveryType(selection.recipients, recipientId, input.value);
    }
    model.operationIds.delete(selectionKey);
    renderRecipients();
  }

  function addExternalRecipient() {
    const email = elements.externalAddress.value.trim().toLowerCase();
    if (!isValidEmail(email)) return options.toast("Ingrese un correo valido.");
    if (model.externalRecipients.some((entry) => entry.email === email)) return options.toast("Ese correo ya fue agregado.");
    model.externalRecipients.push({ name: email, email, deliveryType: "to" });
    elements.externalAddress.value = "";
    renderExternalRecipients();
  }

  function renderExternalRecipients() {
    elements.externalList.innerHTML = model.externalRecipients.map((recipient, index) => `
      <div class="email-recipient-row"><span><strong>${escapeHtml(recipient.email)}</strong><small>Correo externo</small></span><button class="danger" data-remove-external="${index}" type="button">Quitar</button></div>
    `).join("");
  }

  function showPreviewStep() {
    const context = options.getContext();
    const distributions = activeDistributions();
    const errors = [];
    const previews = [];
    for (const distribution of distributions) {
      const validation = validateDistribution({
        requisition: model.requisition,
        recipients: distribution.selection.recipients,
        externalRecipients: distributions.length === 1 ? model.externalRecipients : [],
        missingRequired: distribution.selection.missingRequired,
        permissions: context.permissions,
        allowExternal: model.configuration.settings.allow_external,
        maxRecipients: model.configuration.settings.max_recipients
      });
      errors.push(...validation.errors.map((message) => `${distribution.selection.group.name}: ${message}`));
      if (!validation.ok) continue;
      const key = distribution.selection.group.id || "custom";
      if (!model.operationIds.has(key)) model.operationIds.set(key, makeClientOperationId());
      const requisition = { ...model.requisition, items: distribution.items };
      previews.push({
        key,
        groupId: distribution.selection.group.id || null,
        selection: distribution.selection,
        requisition,
        recipients: validation.recipients,
        externalRecipients: distributions.length === 1 ? model.externalRecipients : [],
        preview: buildEmailPreview({
          requisition,
          distributionName: distribution.selection.group.name,
          originName: departmentName(model.requisition.departmentId),
          destinationName: departmentName(model.requisition.destinationDepartmentId),
          requestedBy: model.requisition.requestedByName || model.requisition.requestedBy,
          recipients: validation.recipients,
          customNote: normalizeCustomNote(elements.customNote.value),
          eventName: elements.eventName.value.trim(),
          isUpdate: hasRequisitionChangedSinceSend(model.requisition, model.sends)
        })
      });
    }
    const split = selectedMixedMode() === "split" && model.suggestions.mixed;
    if (split) {
      const splitResult = splitItemsByDistribution(model.requisition.items, model.configuration.rules, model.configuration.groups);
      if (splitResult.unassigned.length) errors.push("Hay productos sin una regla de distribucion. Use Enviar pedido completo.");
    }
    if (errors.length) return showErrors(errors);
    model.previews = previews;
    renderPreviews();
    elements.composeStep.hidden = true;
    elements.previewStep.hidden = false;
    elements.backButton.hidden = false;
    elements.previewButton.hidden = true;
    elements.sendButton.hidden = false;
    elements.validationList.classList.remove("visible");
  }

  function activeDistributions() {
    const split = selectedMixedMode() === "split" && model.suggestions.mixed;
    if (!split) {
      const selection = [...model.selections.values()][0];
      return selection ? [{ selection, items: model.requisition.items }] : [];
    }
    const splitResult = splitItemsByDistribution(model.requisition.items, model.configuration.rules, model.configuration.groups);
    return splitResult.distributions.map((entry) => ({
      selection: model.selections.get(entry.group.id) || buildGroupSelection(model.configuration, entry.group.id),
      items: entry.items
    }));
  }

  function renderPreviews() {
    elements.previewList.innerHTML = model.previews.map(({ preview }) => `
      <article class="email-preview">
        <h3>${escapeHtml(preview.subject)}</h3>
        <div class="email-preview-meta">
          <span><strong>Para:</strong> ${escapeHtml(preview.to.map((entry) => entry.name).join(", ") || "Ninguno")}</span>
          <span><strong>CC:</strong> ${escapeHtml(preview.cc.map((entry) => entry.name).join(", ") || "Ninguno")}</span>
          <span><strong>BCC:</strong> ${escapeHtml(preview.bcc.map((entry) => entry.name).join(", ") || "Ninguno")}</span>
        </div>
        <table class="email-preview-products"><thead><tr><th>Producto</th><th>Cantidad</th><th>Unidad</th></tr></thead><tbody>
          ${preview.rows.map((row) => `<tr><td>${escapeHtml(row.product)}</td><td>${escapeHtml(row.quantity)}</td><td>${escapeHtml(row.unit)}</td></tr>`).join("")}
        </tbody></table>
        ${preview.customNote ? `<p><strong>Observacion:</strong> ${escapeHtml(preview.customNote)}</p>` : ""}
      </article>
    `).join("");
  }

  async function sendAll() {
    if (model.sending || !model.previews.length) return;
    const duplicates = model.previews.filter(({ groupId }) => model.sends.some((send) =>
      send.status === "sent"
      && Number(send.requisition_revision) === Number(model.requisition.revisionNumber)
      && (send.distribution_group_id || null) === groupId
    ));
    const forceResend = duplicates.length > 0;
    if (forceResend && !window.confirm("Esta revision ya fue enviada a uno de los grupos. ¿Desea reenviar y guardar una nueva auditoria?")) return;
    model.sending = true;
    elements.sendButton.disabled = true;
    elements.sendButton.textContent = "Enviando...";
    try {
      const results = [];
      for (const entry of model.previews) {
        const configuredIds = new Set(entry.selection.recipients.map((recipient) => recipient.id));
        results.push(await sendRequisitionEmail({
          requisitionId: model.requisition.id,
          distributionGroupId: entry.groupId,
          recipientIds: entry.recipients.map((recipient) => recipient.id).filter((id) => id && configuredIds.has(id)),
          recipientSelections: entry.recipients
            .filter((recipient) => recipient.id && configuredIds.has(recipient.id))
            .map((recipient) => ({ id: recipient.id, deliveryType: recipient.deliveryType })),
          itemIds: entry.requisition.items.map((item) => item.id),
          externalRecipients: entry.externalRecipients,
          customNote: normalizeCustomNote(elements.customNote.value),
          eventName: elements.eventName.value.trim(),
          clientOperationId: model.operationIds.get(entry.key),
          expectedRevision: model.requisition.revisionNumber,
          forceResend
        }));
      }
      model.sends = await loadEmailSendHistory(model.requisition.id);
      renderHistory();
      options.toast(results.length === 1 ? "Correo enviado." : `${results.length} correos enviados.`);
      closeDialog();
    } catch (error) {
      showErrors([friendlyError(error, "No se pudo enviar el correo.")]);
    } finally {
      model.sending = false;
      elements.sendButton.disabled = false;
      elements.sendButton.textContent = model.previews.length > 1 ? "Enviar correos" : "Enviar correo";
    }
  }

  function showComposeStep() {
    elements.composeStep.hidden = false;
    elements.previewStep.hidden = true;
    elements.backButton.hidden = true;
    elements.previewButton.hidden = false;
    elements.sendButton.hidden = true;
  }

  function renderOrderSummary() {
    const req = model.requisition;
    elements.dialogTitle.textContent = req.requisitionNumber;
    elements.orderSummary.innerHTML = [
      ["Origen", departmentName(req.departmentId)],
      ["Destino operativo", departmentName(req.destinationDepartmentId)],
      ["Solicitado por", req.requestedByName || req.requestedBy],
      ["Fecha requerida", formatDate(req.requiredAt)],
      ["Prioridad", priorityLabel(req.priority)]
    ].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "No indicado")}</strong></div>`).join("");
  }

  function renderHistory() {
    if (!model.sends.length) {
      elements.sendHistory.innerHTML = "";
      return;
    }
    elements.sendHistory.innerHTML = `<h3>Distribuciones</h3>${model.sends.slice(0, 10).map((send) => `
      <div class="email-admin-row"><span><strong>${escapeHtml(send.distribution_group_name_snapshot || "Personalizado")}</strong><small>${escapeHtml(formatDate(send.sent_at || send.created_at))} · ${escapeHtml(statusLabel(send.status))}</small></span><span>${send.requisition_email_send_recipients?.length || 0} destinatarios</span></div>
    `).join("")}`;
  }

  async function renderAdmin() {
    const context = options.getContext();
    if (!canManageEmailDistribution(context)) return;
    elements.adminRoot.innerHTML = '<p class="hint">Cargando configuracion...</p>';
    try {
      model.configuration = await loadEmailConfiguration(context.organizationId, { activeOnly: false });
      elements.adminRoot.innerHTML = adminMarkup(context, model.configuration);
      renderAdminGroupMembers();
    } catch (error) {
      elements.adminRoot.textContent = friendlyError(error, "No se pudo cargar la configuracion de correo.");
    }
  }

  async function handleAdminSubmit(event) {
    event.preventDefault();
    const context = options.getContext();
    const form = event.target;
    try {
      if (form.id === "emailSettingsForm") {
        await saveEmailSettings(context.organizationId, {
          enabled: form.elements.enabled.checked,
          allowExternal: form.elements.allowExternal.checked,
          maxRecipients: form.elements.maxRecipients.value
        });
        options.toast("Configuracion de correo guardada.");
      }
      if (form.id === "emailRecipientForm") {
        await saveEmailRecipient(context.organizationId, context.userId, {
          id: form.elements.id.value,
          name: form.elements.name.value,
          departmentLabel: form.elements.departmentLabel.value,
          email: form.elements.email.value,
          recipientType: form.elements.recipientType.value,
          active: form.elements.active.checked
        });
        options.toast("Destinatario guardado.");
      }
      if (form.id === "emailGroupForm") {
        await saveDistributionGroup(context.organizationId, context.userId, {
          id: form.elements.id.value,
          name: form.elements.name.value,
          code: form.elements.code.value,
          description: form.elements.description.value,
          active: form.elements.active.checked
        });
        options.toast("Grupo guardado.");
      }
      if (form.id === "emailRuleForm") {
        await saveDistributionRule(context.organizationId, context.userId, {
          name: form.elements.name.value,
          ruleType: form.elements.ruleType.value,
          matchValue: form.elements.matchValue.value,
          groupId: form.elements.groupId.value,
          priority: form.elements.priority.value,
          active: true
        });
        options.toast("Regla guardada.");
      }
      if (form.id === "emailGroupMembersForm") {
        const groupId = form.elements.groupId.value;
        const desired = [...form.querySelectorAll("[data-admin-recipient]")]
          .filter((row) => row.querySelector('[name="included"]').checked)
          .map((row, index) => ({
            recipientId: row.dataset.adminRecipient,
            deliveryType: row.querySelector('[name="deliveryType"]').value,
            defaultSelected: row.querySelector('[name="defaultSelected"]').checked,
            required: row.querySelector('[name="required"]').checked,
            sortOrder: (index + 1) * 10
          }));
        const current = model.configuration.groupRecipients.filter((entry) => entry.group_id === groupId);
        await saveGroupRecipients(context.organizationId, groupId, desired, current);
        options.toast("Miembros del grupo guardados.");
      }
      await renderAdmin();
    } catch (error) {
      options.toast(friendlyError(error, "No se pudo guardar la configuracion."));
    }
  }

  async function handleAdminClick(event) {
    const context = options.getContext();
    const editRecipient = event.target.closest("[data-edit-email-recipient]");
    const editGroup = event.target.closest("[data-edit-email-group]");
    const toggleRecipient = event.target.closest("[data-toggle-email-recipient]");
    const toggleRule = event.target.closest("[data-toggle-email-rule]");
    if (editRecipient) {
      const recipient = model.configuration.recipients.find((entry) => entry.id === editRecipient.dataset.editEmailRecipient);
      populateRecipientForm(recipient);
      return;
    }
    if (editGroup) {
      const group = model.configuration.groups.find((entry) => entry.id === editGroup.dataset.editEmailGroup);
      populateGroupForm(group);
      return;
    }
    try {
      if (toggleRecipient) {
        const recipient = model.configuration.recipients.find((entry) => entry.id === toggleRecipient.dataset.toggleEmailRecipient);
        await saveEmailRecipient(context.organizationId, context.userId, {
          id: recipient.id,
          name: recipient.name,
          departmentLabel: recipient.department_label,
          email: recipient.email,
          recipientType: recipient.recipient_type,
          active: !recipient.active,
          createdBy: recipient.created_by
        });
        await renderAdmin();
      }
      if (toggleRule) {
        const rule = model.configuration.rules.find((entry) => entry.id === toggleRule.dataset.toggleEmailRule);
        await saveDistributionRule(context.organizationId, context.userId, {
          id: rule.id,
          name: rule.name,
          ruleType: rule.rule_type,
          matchValue: rule.match_value,
          groupId: rule.group_id,
          priority: rule.priority,
          active: !rule.active,
          createdBy: rule.created_by
        });
        await renderAdmin();
      }
    } catch (error) {
      options.toast(friendlyError(error, "No se pudo actualizar el registro."));
    }
  }

  function handleAdminChange(event) {
    if (event.target.id === "emailAdminGroupSelect") renderAdminGroupMembers();
  }

  function renderAdminGroupMembers() {
    const form = elements.adminRoot.querySelector("#emailGroupMembersForm");
    if (!form) return;
    const groupId = elements.adminRoot.querySelector("#emailAdminGroupSelect")?.value;
    form.elements.groupId.value = groupId || "";
    const links = model.configuration.groupRecipients.filter((entry) => entry.group_id === groupId);
    form.querySelector("[data-group-member-list]").innerHTML = model.configuration.recipients
      .filter((entry) => entry.active)
      .map((recipient) => {
        const link = links.find((entry) => entry.recipient_id === recipient.id);
        return `<div class="email-admin-row" data-admin-recipient="${escapeHtml(recipient.id)}">
          <label><input name="included" type="checkbox" ${link ? "checked" : ""} /> <span><strong>${escapeHtml(recipient.name)}</strong><small>${escapeHtml(recipient.email)}</small></span></label>
          <select name="deliveryType" aria-label="Entrega"><option value="to" ${link?.delivery_type === "to" ? "selected" : ""}>TO</option><option value="cc" ${link?.delivery_type === "cc" ? "selected" : ""}>CC</option><option value="bcc" ${link?.delivery_type === "bcc" ? "selected" : ""}>BCC</option></select>
          <label><input name="defaultSelected" type="checkbox" ${link?.default_selected !== false ? "checked" : ""} /> Predeterminado</label>
          <label><input name="required" type="checkbox" ${link?.required ? "checked" : ""} /> Requerido</label>
        </div>`;
      }).join("") || '<p class="hint">Configure destinatarios antes de asignar miembros.</p>';
  }

  function populateRecipientForm(recipient) {
    const form = elements.adminRoot.querySelector("#emailRecipientForm");
    if (!form || !recipient) return;
    form.elements.id.value = recipient.id;
    form.elements.name.value = recipient.name;
    form.elements.departmentLabel.value = recipient.department_label;
    form.elements.email.value = recipient.email;
    form.elements.recipientType.value = recipient.recipient_type;
    form.elements.active.checked = recipient.active;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function populateGroupForm(group) {
    const form = elements.adminRoot.querySelector("#emailGroupForm");
    if (!form || !group) return;
    form.elements.id.value = group.id;
    form.elements.name.value = group.name;
    form.elements.code.value = group.code;
    form.elements.description.value = group.description;
    form.elements.active.checked = group.active;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function adminMarkup(context, configuration) {
    const canRecipients = hasEmailPermission(context, EMAIL_PERMISSIONS.manageRecipients);
    const canGroups = hasEmailPermission(context, EMAIL_PERMISSIONS.manageGroups);
    const settings = configuration.settings;
    return `
      ${canRecipients ? `<form class="settings-card" id="emailSettingsForm"><h3>Estado del modulo</h3>
        <label class="check-row"><input name="enabled" type="checkbox" ${settings.enabled ? "checked" : ""} /><span>Activar envio por correo</span></label>
        <label class="check-row"><input name="allowExternal" type="checkbox" ${settings.allow_external ? "checked" : ""} /><span>Permitir correos externos autorizados</span></label>
        <label>Maximo de destinatarios<input name="maxRecipients" type="number" min="1" max="50" value="${Number(settings.max_recipients) || 25}" /></label>
        <button type="submit">Guardar configuracion</button>
      </form>` : ""}
      ${canRecipients ? `<form class="settings-card" id="emailRecipientForm"><h3>Destinatarios</h3>
        <input name="id" type="hidden" />
        <div class="form-grid"><label>Nombre<input name="name" required maxlength="120" /></label><label>Departamento o funcion<input name="departmentLabel" maxlength="120" /></label><label>Correo<input name="email" type="email" required maxlength="254" /></label><label>Tipo<select name="recipientType">${recipientTypeOptions()}</select></label></div>
        <label class="check-row"><input name="active" type="checkbox" checked /><span>Activo</span></label>
        <button type="submit">Guardar destinatario</button>
        <div class="email-admin-list">${configuration.recipients.map((recipient) => `<div class="email-admin-row"><span><strong>${escapeHtml(recipient.name)}</strong><small>${escapeHtml(recipient.email)} · ${escapeHtml(recipientRoleLabel(recipient.recipient_type))}</small></span><div class="card-actions"><button class="secondary" data-edit-email-recipient="${escapeHtml(recipient.id)}" type="button">Editar</button><button class="${recipient.active ? "danger" : "secondary"}" data-toggle-email-recipient="${escapeHtml(recipient.id)}" type="button">${recipient.active ? "Desactivar" : "Activar"}</button></div></div>`).join("") || '<p class="hint">No hay destinatarios configurados.</p>'}</div>
      </form>` : ""}
      ${canGroups ? `<form class="settings-card" id="emailGroupForm"><h3>Grupos</h3><input name="id" type="hidden" /><div class="form-grid"><label>Nombre<input name="name" required maxlength="120" /></label><label>Codigo<input name="code" required maxlength="40" pattern="[A-Z0-9_-]+" /></label><label>Descripcion<input name="description" maxlength="500" /></label></div><label class="check-row"><input name="active" type="checkbox" checked /><span>Activo</span></label><button type="submit">Guardar grupo</button><div class="email-admin-list">${configuration.groups.map((group) => `<div class="email-admin-row"><span><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.code)} · ${group.active ? "Activo" : "Inactivo"}</small></span><button class="secondary" data-edit-email-group="${escapeHtml(group.id)}" type="button">Editar</button></div>`).join("")}</div></form>
      <section class="settings-card"><h3>Miembros por grupo</h3><label>Grupo<select id="emailAdminGroupSelect">${configuration.groups.filter((group) => group.active).map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`).join("")}</select></label><form id="emailGroupMembersForm" class="email-admin-group-editor"><input name="groupId" type="hidden" /><div data-group-member-list></div><button type="submit">Guardar miembros</button></form></section>
      <form class="settings-card" id="emailRuleForm"><h3>Reglas</h3><div class="form-grid"><label>Nombre<input name="name" required maxlength="120" /></label><label>Tipo<select name="ruleType"><option value="category">Categoria</option><option value="explicit_event">Evento explicito</option><option value="custom">Personalizada</option></select></label><label>Coincidencia<input name="matchValue" maxlength="160" /></label><label>Grupo<select name="groupId">${configuration.groups.filter((group) => group.active).map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`).join("")}</select></label><label>Prioridad<input name="priority" type="number" min="0" max="10000" value="100" /></label></div><button type="submit">Agregar regla</button><div class="email-admin-list">${configuration.rules.map((rule) => `<div class="email-admin-row"><span><strong>${escapeHtml(rule.name)}</strong><small>${escapeHtml(rule.rule_type)} · ${escapeHtml(rule.match_value)}</small></span><button class="${rule.active ? "danger" : "secondary"}" data-toggle-email-rule="${escapeHtml(rule.id)}" type="button">${rule.active ? "Desactivar" : "Activar"}</button></div>`).join("")}</div></form>` : ""}`;
  }

  function showErrors(errors) {
    elements.validationList.innerHTML = [...new Set(errors)].map((message) => `<p>${escapeHtml(message)}</p>`).join("");
    elements.validationList.classList.add("visible");
  }

  function selectedMixedMode() {
    return elements.mixedOptions.querySelector('input[name="emailMixedMode"]:checked')?.value || "full";
  }

  function departmentName(id) {
    return options.getDepartments().find((entry) => entry.id === id)?.name || "No indicado";
  }

  function formatDate(value) {
    if (!value) return "No indicada";
    const parts = options.formatDate(value);
    return `${parts.date} ${parts.time}`;
  }
}

function canOfferEmail(context, requisition) {
  return Boolean(
    hasEmailPermission(context, EMAIL_PERMISSIONS.send)
    && requisition?.id
    && !["draft", "review", "voided", "rejected"].includes(requisition.status)
  );
}

function enrichRequisition(requisition, catalog) {
  const products = catalog || [];
  return {
    ...requisition,
    items: (requisition.items || []).map((item) => {
      const product = products.find((entry) =>
        (item.productId && entry.id === item.productId) || (item.productCode && entry.code === item.productCode)
      );
      return { ...item, category: product?.category || "" };
    })
  };
}

function collectElements() {
  return {
    emailButton: document.querySelector("#emailButton"),
    dialog: document.querySelector("#emailDistributionDialog"),
    dialogTitle: document.querySelector("#emailDialogTitle"),
    closeButton: document.querySelector("#emailCloseButton"),
    cancelButton: document.querySelector("#emailCancelButton"),
    backButton: document.querySelector("#emailBackButton"),
    previewButton: document.querySelector("#emailPreviewButton"),
    sendButton: document.querySelector("#emailSendButton"),
    orderSummary: document.querySelector("#emailOrderSummary"),
    featureNotice: document.querySelector("#emailFeatureNotice"),
    composeStep: document.querySelector("#emailComposeStep"),
    previewStep: document.querySelector("#emailPreviewStep"),
    groupSelect: document.querySelector("#emailDistributionGroup"),
    mixedOptions: document.querySelector("#emailMixedOptions"),
    recipientList: document.querySelector("#emailRecipientList"),
    recipientCount: document.querySelector("#emailRecipientCount"),
    recipientHint: document.querySelector("#emailRecipientHint"),
    externalBlock: document.querySelector("#emailExternalBlock"),
    externalAddress: document.querySelector("#emailExternalAddress"),
    addExternalButton: document.querySelector("#emailAddExternalButton"),
    externalList: document.querySelector("#emailExternalList"),
    eventLabel: document.querySelector("#emailEventLabel"),
    eventName: document.querySelector("#emailEventName"),
    customNote: document.querySelector("#emailCustomNote"),
    validationList: document.querySelector("#emailValidationList"),
    previewList: document.querySelector("#emailPreviewList"),
    sendHistory: document.querySelector("#emailSendHistory"),
    adminRoot: document.querySelector("#emailAdminRoot")
  };
}

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeDialog() {
  const dialog = document.querySelector("#emailDistributionDialog");
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function priorityLabel(value) {
  return { normal: "Normal", urgent: "Urgente", emergency: "Emergencia" }[value] || "Normal";
}

function statusLabel(value) {
  return {
    pending: "Pendiente",
    sending: "Enviando",
    sent: "Correo enviado",
    failed: "Error al enviar",
    delivered: "Entregado",
    bounced: "Rebotado",
    complained: "Queja"
  }[value] || value;
}

function recipientTypeOptions() {
  return ["warehouse", "purchasing", "security", "controller", "costs", "management", "other"]
    .map((type) => `<option value="${type}">${escapeHtml(recipientRoleLabel(type))}</option>`)
    .join("");
}

function friendlyError(error, fallback) {
  const message = String(error?.message || "");
  if (message.includes("FunctionsHttpError")) return "El servicio de correo rechazo la solicitud.";
  if (message.includes("Failed to fetch")) return "No hay conexion con el servicio de correo.";
  return message && message.length < 220 ? message : fallback;
}
