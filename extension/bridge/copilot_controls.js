(() => {
  const enabled = (e) =>
    !e.disabled &&
    e.getAttribute("aria-disabled") !== "true" &&
    !e.hidden &&
    e.getAttribute("aria-hidden") !== "true";
  const label = (e) =>
    (
      e.getAttribute("aria-label") ||
      e.getAttribute("title") ||
      e.textContent ||
      ""
    ).trim();
  const stopButtons = () =>
    Array.from(document.querySelectorAll('button,[role="button"]')).filter(
      (e) =>
        enabled(e) &&
        /^stop(?: (?:generating(?: (?:a )?response)?|response|responding|generation))?$/i.test(
          label(e),
        ),
    );
  const failure = (scope) => {
    if (!scope) return null;
    const retry = Array.from(
      scope.querySelectorAll('button,[role="button"]'),
    ).some((e) => enabled(e) && /^(try again|retry)$/i.test(label(e)));
    const nodes = Array.from(
      scope.querySelectorAll('[role="alert"],p,span,div'),
    ).filter(
      (e) =>
        !e.closest(
          '[data-testid="markdown-reply"],[data-testid="chatQuestion"],pre,code',
        ) &&
        !e.querySelector(
          '[data-testid="markdown-reply"],[data-testid="chatQuestion"],pre,code',
        ),
    );
    const error = nodes.some(
      (e) =>
        enabled(e) &&
        (e.textContent || "").length < 700 &&
        /oops[!\s]*something (?:happened|went wrong)|something went wrong[.!]?\s*(?:please |can you )?try again/i.test(
          e.textContent || "",
        ) &&
        (retry || e.getAttribute("role") === "alert"),
    );
    return error
      ? {
          message: "Oops! Something happened. Can you try again?",
          retryAvailable: retry,
        }
      : null;
  };
  const stop = (prompt) => {
    const buttons = stopButtons();
    if (!buttons.length) return { clicked: false, alreadyIdle: true };
    const last = Array.from(
      document.querySelectorAll(
        '[data-testid="m365-chat-llm-web-ui-chat-message"]',
      ),
    ).at(-1);
    const question =
      last?.querySelector(
        '[data-testid="chatQuestion"] [data-testid="chatOutput"]',
      )?.innerText || "";
    const canonical = (s) => s.replace(/\s/g, "");
    if (buttons.length !== 1 || canonical(question) !== canonical(prompt))
      return {
        error: "Stop target is missing, ambiguous, or belongs to another turn",
      };
    buttons[0].click();
    return { clicked: true };
  };
  const stopped = (turn) => {
    if (!turn) return false;
    const regenerate = Array.from(turn.querySelectorAll('button,[role="button"]'))
      .some((e) => enabled(e) && !e.closest('[data-testid="chatQuestion"],[data-testid="markdown-reply"],[hidden],[aria-hidden="true"]') &&
        /^regenerate(?: (?:the )?response)?$/i.test(label(e)));
    return regenerate && Array.from(turn.querySelectorAll('[role="alert"],[role="status"],p,span,div'))
      .some((e) => enabled(e) && !e.closest('[data-testid="chatQuestion"],pre,code,[hidden],[aria-hidden="true"]') &&
        /^(?:ok[,!.]?\s*)?i(?:'|’)ve stopped generating (?:the |a )?response[.!]?$/i.test((e.textContent || "").trim()));
  };
  const attachmentButtons = () => {
    const composer = document.querySelector('#chat-input-wrapper') ||
      document.querySelector('[data-testid="bizchat-input-section"]') || document;
    return Array.from(composer.querySelectorAll('button[aria-label^="Remove attachment "]'))
      .filter((e) => !e.closest('[hidden],[aria-hidden="true"],[data-testid="markdown-reply"],[data-testid="chatQuestion"]'));
  };
  const attachmentNames = () => attachmentButtons().map((e) =>
    e.getAttribute("aria-label").slice("Remove attachment ".length));
  const removeAttachment = (route, expected) => {
    const buttons = attachmentButtons();
    if (location.pathname !== route || stopButtons().length ||
      JSON.stringify(attachmentNames()) !== JSON.stringify(expected) ||
      !buttons.length || !enabled(buttons[0])) return false;
    buttons[0].click();
    return true;
  };
  return { stopButtons, failure, stop, stopped, attachmentNames, removeAttachment };
})();
