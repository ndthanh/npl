(windows) => {
  const unique = (values) => [...new Set(values.map((w) => w.tid))];
  const visible = unique(windows.filter((w) => w.visible));
  const visibleMain = unique(
    windows.filter(
      (w) => w.visible && /^Chrome_WidgetWin_1$/i.test(w.className),
    ),
  );
  if (visibleMain.length === 1) return visibleMain[0];
  const main = unique(
    windows.filter((w) => /^Chrome_WidgetWin_1$/i.test(w.className)),
  );
  if (main.length === 1) return main[0];
  if (!main.length && visible.length === 1) return visible[0];
  const all = unique(windows);
  if (all.length === 1) return all[0];
  throw Error(
    "Không xác định được duy nhất Teams UI thread (visible=" +
      visible.length +
      ", hidden/main=" +
      main.length +
      "). Hãy mở lại cửa sổ Teams từ system tray rồi Connect. Không gửi yêu cầu.",
  );
};
