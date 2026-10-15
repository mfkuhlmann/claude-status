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
    headline: headlineText(state, counts),
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
            <GroupSection key={groupKeyOf(g)} group={g} />
          ))}
          {state.hosts.map((h) => (
            <HostSection key={h.name} host={h} groups={groups.filter((g) => g.host === h.name)} />
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
