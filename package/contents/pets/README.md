# Talpa's pictures

Talpa, the pet, is drawn by code (`package/contents/ui/talpa/`): its parts,
moods and everything it does. The same code draws it in the Plasma widget
(QML Canvas), the GNOME extension (Cairo) and the VS Code extension (an HTML
canvas).

The SVG files here are still pictures made from that code for places that
need a file, the notification icons (`notify-*.svg`) and the GNOME
extension's notification source (`talpa.svg`). Make them again after changing
how Talpa looks:

    node tools/talpa_icons.mjs
