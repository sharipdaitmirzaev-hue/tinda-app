"use client";

import { useEffect, useMemo, useState } from "react";
import {
  detect_is_ios,
  detect_is_standalone,
  should_show_install_prompt,
} from "@/lib/pwa/install-prompt";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "tinda_pwa_install_dismissed";

export function PwaInstallPrompt() {
  const [deferred, set_deferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [standalone, set_standalone] = useState(true);
  const [ios, set_ios] = useState(false);
  const [dismissed, set_dismissed] = useState(true);
  const [ios_help_open, set_ios_help_open] = useState(false);

  useEffect(() => {
    const match = (query: string) =>
      window.matchMedia?.(query)?.matches ?? false;
    set_standalone(
      detect_is_standalone(match, Boolean(
        // iOS Safari
        (window.navigator as Navigator & { standalone?: boolean }).standalone,
      )),
    );
    set_ios(detect_is_ios(window.navigator.userAgent));
    set_dismissed(window.sessionStorage.getItem(DISMISS_KEY) === "1");

    const on_bip = (event: Event) => {
      event.preventDefault();
      set_deferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", on_bip);
    return () => window.removeEventListener("beforeinstallprompt", on_bip);
  }, []);

  const visible = useMemo(() => {
    if (dismissed) return false;
    return should_show_install_prompt({
      can_install: Boolean(deferred),
      is_standalone: standalone,
      is_ios: ios && !deferred,
    });
  }, [deferred, dismissed, ios, standalone]);

  if (!visible) return null;

  const dismiss = () => {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
    set_dismissed(true);
    set_ios_help_open(false);
  };

  const on_install = async () => {
    if (deferred) {
      await deferred.prompt();
      try {
        await deferred.userChoice;
      } catch {
        /* ignore */
      }
      set_deferred(null);
      dismiss();
      return;
    }
    set_ios_help_open(true);
  };

  return (
    <div
      className="fixed inset-x-0 z-40 px-3 md:left-auto md:right-4 md:max-w-sm"
      style={{
        bottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))",
      }}
      role="region"
      aria-label="Установка приложения"
    >
      <div className="rounded-lg border border-teal-200 bg-white p-3 shadow-md">
        <p className="text-sm font-semibold text-slate-900">
          Установить приложение
        </p>
        {ios_help_open ? (
          <p className="mt-1 text-sm text-slate-600">
            Нажмите «Поделиться» → «На экран Домой».
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-600">
            {ios
              ? "Добавьте ТИНДА на экран Домой для быстрого входа."
              : "Установите ТИНДА на телефон — без адресной строки."}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          {!ios_help_open ? (
            <button type="button" className="ui-btn-primary" onClick={on_install}>
              Установить приложение
            </button>
          ) : null}
          <button type="button" className="ui-btn-secondary" onClick={dismiss}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
