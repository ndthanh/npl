import type { ProjectPicker, ProjectEntry } from "./project-context";

const size = (n: number) =>
  n >= 1048576
    ? (n / 1048576).toFixed(1) + " MB"
    : n >= 1024
      ? (n / 1024).toFixed(1) + " KB"
      : n + " B";
let current: { revision: string; element: HTMLElement } | undefined;

// Mounted outside the chat render root so live bridge output never destroys
// checkbox focus, search text, scroll position, or an unsaved selection.
export function syncProjectPicker(
  model: ProjectPicker | undefined,
  post: (type: string, extra?: any) => void,
) {
  if (!model) {
    const restoreFocus = current?.element.contains(document.activeElement);
    current?.element.remove();
    current = undefined;
    if (restoreFocus)
      document
        .querySelector<HTMLElement>('[data-action="projectPicker"]')
        ?.focus();
    return;
  }
  if (current?.revision === model.revision) return;
  current?.element.remove();
  const overlay = document.createElement("div");
  overlay.className = "project-overlay";
  overlay.innerHTML = `<section class="project-dialog" role="dialog" aria-modal="true" aria-label="Chọn project context"><div class="project-heading"><strong>Project context</strong><button data-picker-close aria-label="Đóng cây project">×</button></div><div class="project-root"></div><p class="project-help">Chỉ gửi file đã chọn. Quy tắc .nopilotignore luôn được áp dụng.</p><input class="project-search" type="search" aria-label="Tìm file trong project" placeholder="Tìm tên file hoặc đường dẫn…"><div class="project-toolbar"><button data-picker-default>Chọn mặc định</button><button data-picker-none>Bỏ chọn tất cả</button><button data-picker-refresh>Làm mới</button><label><input type="checkbox" data-picker-ignored> Hiện đã loại trừ</label></div><div class="project-tree" role="group" aria-label="Cây file project"></div><div class="project-summary" aria-live="polite"></div><small class="project-policy"></small><div class="project-footer"><button data-picker-cancel>Hủy</button><button class="primary" data-picker-save>Lưu lựa chọn</button></div></section>`;
  document.body.append(overlay);
  current = { revision: model.revision, element: overlay };
  overlay.querySelector(".project-root")!.textContent = model.root;
  const eligible = model.entries.filter((e) => !e.directory && !e.blocked);
  let defaults = model.selection === undefined;
  const selected = new Set(
    defaults ? eligible.map((e) => e.path) : model.selection,
  );
  const descendants = new Map<string, string[]>();
  descendants.set(
    "",
    eligible.map((e) => e.path),
  );
  const children = new Map<string, ProjectEntry[]>();
  for (const e of model.entries) {
    const parent = e.path.includes("/")
      ? e.path.slice(0, e.path.lastIndexOf("/"))
      : "";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(e);
    if (!e.directory && !e.blocked) {
      let parentPath = parent;
      while (parentPath) {
        if (!descendants.has(parentPath)) descendants.set(parentPath, []);
        descendants.get(parentPath)!.push(e.path);
        parentPath = parentPath.includes("/")
          ? parentPath.slice(0, parentPath.lastIndexOf("/"))
          : "";
      }
      descendants.set(e.path, [e.path]);
    }
  }
  const expanded = new Map<string, boolean>();
  const tree = overlay.querySelector<HTMLElement>(".project-tree")!;
  const search = overlay.querySelector<HTMLInputElement>(".project-search")!;
  const ignored = overlay.querySelector<HTMLInputElement>(
    "[data-picker-ignored]",
  )!;
  function updateChecks() {
    for (const box of tree.querySelectorAll<HTMLInputElement>(
      "input[data-project-path]",
    )) {
      const names = descendants.get(box.dataset.projectPath!) ?? [];
      const count = names.filter((n) => selected.has(n)).length;
      box.checked = names.length > 0 && count === names.length;
      box.indeterminate = count > 0 && count < names.length;
      box.disabled = !names.length;
    }
    const files = eligible.filter((e) => selected.has(e.path));
    overlay.querySelector(".project-summary")!.textContent =
      `${files.length}/${eligible.length} file · ${size(files.reduce((n, e) => n + e.bytes, 0))} trước nén`;
    overlay.querySelector(".project-policy")!.textContent = defaults
      ? "Mặc định: file hợp lệ mới sẽ tự được chọn ở lần gửi tiếp theo."
      : "Tùy chọn: chỉ gửi danh sách đã lưu. File mới cần được chọn thêm hoặc dùng Chọn mặc định.";
  }
  function checkbox(name: string, title: string) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.projectPath = name;
    box.setAttribute("aria-label", title);
    box.addEventListener("click", (e) => e.stopPropagation());
    box.addEventListener("change", () => {
      defaults = false;
      for (const file of descendants.get(name) ?? [])
        box.checked ? selected.add(file) : selected.delete(file);
      updateChecks();
    });
    return box;
  }
  function renderTree() {
    const scroll = tree.scrollTop;
    tree.replaceChildren();
    const query = search.value.toLocaleLowerCase().trim();
    const visible = new Set<string>();
    for (const e of model!.entries)
      if (
        (!e.blocked || ignored.checked) &&
        (!query || e.path.toLocaleLowerCase().includes(query))
      ) {
        let name = e.path;
        while (name) {
          visible.add(name);
          name = name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "";
        }
      }
    const all = document.createElement("label");
    all.className = "project-row project-all";
    all.append(
      checkbox("", "Chọn tất cả file hợp lệ"),
      document.createTextNode("Tất cả file hợp lệ"),
    );
    tree.append(all);
    function append(parent: string, target: HTMLElement, depth: number) {
      const rows = (children.get(parent) ?? [])
        .filter((e) => visible.has(e.path))
        .sort(
          (a, b) =>
            Number(b.directory) - Number(a.directory) ||
            a.path.localeCompare(b.path),
        );
      for (const entry of rows) {
        const row = document.createElement(
          entry.directory ? "summary" : "label",
        );
        row.className = "project-row";
        row.title = entry.reason || entry.path;
        const label = document.createElement("span");
        label.textContent =
          entry.path.split("/").at(-1)! + (entry.directory ? "/" : "");
        row.append(checkbox(entry.path, "Include " + entry.path), label);
        if (entry.blocked) {
          row.classList.add("project-blocked");
          const reason = document.createElement("small");
          reason.textContent = entry.reason!;
          row.append(reason);
        } else if (!entry.directory) {
          const bytes = document.createElement("small");
          bytes.textContent = size(entry.bytes);
          row.append(bytes);
        }
        if (entry.directory) {
          const folder = document.createElement("details");
          folder.dataset.projectFolder = entry.path;
          folder.open = !!query || (expanded.get(entry.path) ?? depth === 0);
          folder.append(row);
          const nested = document.createElement("div");
          nested.className = "project-children";
          append(entry.path, nested, depth + 1);
          folder.append(nested);
          folder.addEventListener("toggle", () =>
            expanded.set(entry.path, folder.open),
          );
          target.append(folder);
        } else target.append(row);
      }
    }
    append("", tree, 0);
    updateChecks();
    tree.scrollTop = scroll;
  }
  search.addEventListener("input", renderTree);
  ignored.addEventListener("change", renderTree);
  overlay
    .querySelector("[data-picker-default]")!
    .addEventListener("click", () => {
      defaults = true;
      selected.clear();
      for (const e of eligible) selected.add(e.path);
      updateChecks();
    });
  overlay.querySelector("[data-picker-none]")!.addEventListener("click", () => {
    defaults = false;
    selected.clear();
    updateChecks();
  });
  overlay
    .querySelector("[data-picker-refresh]")!
    .addEventListener("click", () => {
      // Preserve unsaved edits across a disk refresh, scoped to this conversation.
      post("projectPicker", {
        draft: { revision: model!.revision, defaults, paths: [...selected] },
      });
    });
  for (const selector of ["[data-picker-close]", "[data-picker-cancel]"])
    overlay
      .querySelector(selector)!
      .addEventListener("click", () => post("closeProjectPicker"));
  overlay.querySelector("[data-picker-save]")!.addEventListener("click", () =>
    post("saveProjectSelection", {
      revision: model!.revision,
      defaults,
      paths: [...selected],
    }),
  );
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      post("closeProjectPicker");
    }
    if (e.key === "Tab") {
      const focusable = [
        ...overlay.querySelectorAll<HTMLElement>("button,input,summary"),
      ].filter(
        (el) =>
          !(el as HTMLInputElement).disabled && el.getClientRects().length,
      );
      const first = focusable[0],
        last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  });
  renderTree();
  search.focus();
}
