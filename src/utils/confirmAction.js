// App-owned modal; text is assigned with textContent to avoid HTML injection.
export function confirmAction(message, { title = '삭제 확인', confirmLabel = '삭제', danger = true } = {}) {
  return new Promise(resolve => {
    const previous = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'app-confirm-dialog';
    const heading = document.createElement('h2'); heading.id = 'app-confirm-title'; heading.textContent = title;
    dialog.setAttribute('aria-labelledby', heading.id);
    const text = document.createElement('p'); text.textContent = message;
    const actions = document.createElement('div'); actions.className = 'app-confirm-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'management-back'; cancel.textContent = '취소';
    const accept = document.createElement('button'); accept.type = 'button'; accept.className = danger ? 'management-delete' : 'management-add'; accept.textContent = confirmLabel;
    let done = false;
    const finish = value => { if (done) return; done = true; dialog.close(); dialog.remove(); previous?.focus(); resolve(value); };
    cancel.onclick = () => finish(false); accept.onclick = () => finish(true);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    actions.append(cancel, accept); dialog.append(heading, text, actions); document.body.append(dialog); dialog.showModal(); cancel.focus();
  });
}
