// Small outlined label next to a chat's name: its profile, "VS Code", …
export function Tag(props: {
  text: string;
  title?: string;
  active?: boolean; // outlined in the accent color
  pressed?: boolean;
  onClick?: () => void;
}) {
  const cls = "tag" + (props.active ? " active" : "");
  if (props.onClick)
    return (
      <button type="button" class={cls + " clickable"} title={props.title} aria-pressed={props.pressed} onClick={props.onClick}>
        {props.text}
      </button>
    );
  return (
    <span class={cls} title={props.title}>
      {props.text}
    </span>
  );
}
