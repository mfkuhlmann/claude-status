import {
  allGroups,
  countStates,
  firstWaiting,
  headlineText,
  heroMood,
  highUsageText,
  maxFiveHour,
  overallState,
} from "../../src/shared/model";
import { Component, type ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { editorTab } from "../env";
import { pets } from "../pets";
import type { HeroInput } from "../pets/api";
import { chatRefOf, contextFullText, groupKeyOf } from "../util/chat";
import { useStore } from "../util/store";
import { petColorsVersion, viewState } from "../util/stores";
import { ViewContext } from "./context";
import { GroupSection } from "./GroupSection";
import { Header } from "./Header";
import { HeroStage } from "./HeroStage";
import { HostSection } from "./HostSection";
import { Messages } from "./Messages";

const appClass = "app" + (editorTab ? " tab" : "");

// A shadow under the sticky top once the list scrolls under it
function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scrolled;
}

// One account's (or host's) section: if drawing it fails, the others still
// show, and it says so instead of the view going blank
class Guarded extends Component<{ what: string; children: ComponentChildren }, { failed: string }> {
  state = { failed: "" };
  componentDidCatch(error: unknown): void {
    this.setState({ failed: error instanceof Error ? error.message : String(error) });
  }
  componentDidUpdate(previous: { children: ComponentChildren }): void {
    if (this.state.failed && previous.children !== this.props.children) this.setState({ failed: "" }); // new data: try again
  }
  render() {
    return this.state.failed ? (
      <div class="msg error" role="alert">
        Couldn't show {this.props.what}: {this.state.failed}
      </div>
    ) : (
      this.props.children
    );
  }
}

// The popup's layout: header and the big Clawd on top (they stay while the
// list scrolls), then this computer's accounts, then each SSH host's.
export function App() {
  const state = useStore(viewState);
  // pets changed color: repaint the bars next to their rows
  useStore(petColorsVersion);
  const scrolled = useScrolled();

  if (!state)
    return (
      <div class={appClass}>
        <div class="empty muted">Looking for your chats…</div>
      </div>
    );

  const groups = allGroups(state.status, state.hosts);
  const counts = countStates(groups);
  const overall = overallState(groups, counts);
  const waiting = firstWaiting(groups);
  const hero: HeroInput = {
    mood: heroMood(state, overall, groups),
    headline: headlineText(state, counts, groups.length > 0),
    counts,
    highUsageText: highUsageText(groups),
    contextFullText: contextFullText(groups, (key) => pets.petColor(key)),
    maxFiveHour: maxFiveHour(groups),
    waiting: waiting ? chatRefOf(waiting.session, waiting.group.host) : null,
  };
  const local = state.status ? state.status.groups : [];

  return (
    <ViewContext.Provider value={state}>
      <div class={appClass}>
        <div class={"top" + (scrolled ? " scrolled" : "")}>
          <Header
            overall={overall}
            counts={counts}
            groups={groups}
            hosts={state.hosts}
            answered={!!state.status || groups.length > 0}
            unavailable={!state.status && !!state.errorText}
            heroShown={state.settings.showPet}
          />
          {state.settings.showPet ? <HeroStage input={hero} /> : null}
        </div>
        <main class="content">
          <Messages state={state} />
          {!state.status && !state.errorText ? <div class="empty muted">Looking for your chats…</div> : null}
          {local.map((g) => (
            <Guarded key={groupKeyOf(g)} what={g.name}>
              <GroupSection group={g} />
            </Guarded>
          ))}
          {state.hosts.map((h) => (
            <Guarded key={h.name} what={h.name}>
              {/* its last answer, also when the last check failed (dimmed): allGroups leaves that one out */}
              <HostSection host={h} groups={(h.result?.groups ?? []).map((g) => ({ ...g, host: h.name }))} />
            </Guarded>
          ))}
          {state.status && groups.length === 0 && state.hosts.length === 0 ? (
            <div class="empty">
              <p>
                Your Claude Code chats show up here once you start <code>claude</code> in a terminal or open
                Claude in VS Code.
              </p>
              <p class="muted">
                {editorTab
                  ? "Chats on other machines: add SSH hosts with the hosts button above."
                  : "Chats on other machines: add SSH hosts from the view's title bar."}
              </p>
            </div>
          ) : null}
        </main>
      </div>
    </ViewContext.Provider>
  );
}
