const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const validLength = (value: string): boolean => /^[\s\S]{16,1024}$/.test(value);

export function setupPasswordFields(onInput: () => void): { update: () => boolean } {
  const fields = ['new-password', 'confirm-password', 'unlock-password'].map((id) => ({
    input: element<HTMLInputElement>(id),
    toggle: element<HTMLButtonElement>(`${id}-toggle`),
    label: id === 'new-password' ? 'new backup password' : id === 'confirm-password' ? 'confirmation password' : 'backup password',
  }));
  function visibility(field: typeof fields[number], visible: boolean): void {
    field.input.type = visible ? 'text' : 'password';
    field.toggle.setAttribute('aria-pressed', String(visible));
    field.toggle.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} ${field.label}`);
  }
  for (const field of fields) {
    field.input.addEventListener('input', onInput);
    field.toggle.addEventListener('click', () => {
      if (field.input.disabled || !field.input.value) return;
      visibility(field, field.input.type === 'password');
    });
  }
  return { update(): boolean {
    const password = fields[0]!.input.value;
    const confirmation = fields[1]!.input.value;
    const lengthOkay = validLength(password);
    const matches = lengthOkay && password === confirmation;
    const lengthHint = element('password-length');
    lengthHint.textContent = password.length > 1024 ? 'Password is too long. Use no more than 1024 characters.'
      : lengthOkay ? `${password.length} characters · Minimum length met.`
        : `${password.length} / 16 characters · Add ${16 - password.length} more.`;
    lengthHint.setAttribute('data-state', password.length === 0 ? 'neutral' : lengthOkay ? 'valid' : 'invalid');
    fields[0]!.input.setAttribute('aria-invalid', String(password.length > 0 && !lengthOkay));
    const matchHint = element('password-match');
    matchHint.textContent = !confirmation ? 'Re-enter your password to confirm it.'
      : password !== confirmation ? 'Passwords do not match yet.'
        : lengthOkay ? 'Passwords match.' : 'Passwords match; the password still needs at least 16 characters.';
    matchHint.setAttribute('data-state', !confirmation ? 'neutral' : matches ? 'valid' : 'invalid');
    fields[1]!.input.setAttribute('aria-invalid', String(confirmation.length > 0 && !matches));
    for (const field of fields) {
      field.toggle.disabled = field.input.disabled || !field.input.value;
      if (field.toggle.disabled) visibility(field, false);
    }
    return matches;
  } };
}
