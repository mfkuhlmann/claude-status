import type { ViewState } from "../../src/shared/types";

// What went wrong (or right) outside the list: the status itself, the last
// action, the platform; and a reminder when the data is made up.
export function Messages({ state }: { state: ViewState }) {
  return (
    <>
      {state.demo ? (
        <div class="msg banner" role="note">
          Demo data — run “Claude Status: Toggle Demo Data” to go back
        </div>
      ) : null}
      {state.errorText ? (
        <div class="msg error" role="alert">
          {state.errorText}
        </div>
      ) : null}
      {state.actionError ? (
        <div class="msg error" role="alert">
          {state.actionError}
        </div>
      ) : null}
      {state.actionInfo ? (
        <div class="msg info" role="status">
          {state.actionInfo}
        </div>
      ) : null}
      {state.platformNote ? <div class="msg muted">{state.platformNote}</div> : null}
    </>
  );
}
