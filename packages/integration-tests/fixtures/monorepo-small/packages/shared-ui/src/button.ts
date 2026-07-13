export interface ButtonProps {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}

export function createButton(props: ButtonProps): HTMLElement {
  const button = document.createElement("button");
  button.textContent = props.label;
  button.onclick = props.onClick;
  button.className = `btn btn-${props.variant ?? "primary"}`;
  if (props.disabled) button.disabled = true;
  return button;
}
