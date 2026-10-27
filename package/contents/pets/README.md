# Talpy's pictures

Talpy, the pet, is drawn by code (`package/contents/ui/talpy/`): its parts,
moods and everything it does. The same code draws it in the Plasma widget
(QML Canvas), the GNOME extension (Cairo) and the VS Code extension (an HTML
canvas).

The SVG files here are still pictures made from that code for places that
need a file: the notification icons (`notify-*.svg`), the GNOME extension's
notification source (`talpy.svg`) and the chat pane's icon in the taskbar
(`window.svg`, given to the pane by install.sh's KWin window rule). Make them
again after changing how Talpy looks:

    node tools/talpy_icons.mjs
