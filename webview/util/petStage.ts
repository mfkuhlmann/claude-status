// Mounts a pet stage (webview/pets) on an element and keeps it fed: new
// input when it changed, and animations only while someone can see them.

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ChatRef } from "../../src/shared/types";
import { post } from "../env";
import type { AccountInput, HeroInput, PetStage, StageCallbacks } from "../pets/api";
import { useStore } from "./store";
import { hostVisible, pageVisible } from "./stores";

export const stageCallbacks: StageCallbacks = {
  open(chat: ChatRef) {
    post({ type: "open", chat });
  },
};

export function useViewVisible(): boolean {
  const host = useStore(hostVisible);
  const page = useStore(pageVisible);
  return host && page;
}

// `active`: the stage is open (an account's stage folds away without chats)
export function usePetStage(
  create: (el: HTMLElement) => PetStage,
  input: HeroInput | AccountInput,
  active: boolean,
) {
  const ref = useRef<HTMLDivElement>(null);
  const stage = useRef<PetStage | null>(null);
  const lastInput = useRef("");
  // stages start live; the observer says soon enough if it's off screen
  const [onScreen, setOnScreen] = useState(true);
  const visible = useViewVisible();

  // Layout effects: the stage is there, with its pets, in the first paint
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    stage.current = create(el);
    lastInput.current = "";
    const io = new IntersectionObserver((entries) => setOnScreen(entries[entries.length - 1].isIntersecting));
    io.observe(el);
    return () => {
      io.disconnect();
      stage.current?.destroy();
      stage.current = null;
    };
  }, []);

  // Every poll brings new objects: only pass on what really changed
  const json = JSON.stringify(input);
  useLayoutEffect(() => {
    if (stage.current && json !== lastInput.current) {
      lastInput.current = json;
      stage.current.update(input);
    }
  }, [json]);

  const live = visible && onScreen && active;
  useEffect(() => {
    stage.current?.setLive(live);
  }, [live]);

  return ref;
}
