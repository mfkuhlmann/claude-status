# Pet artwork

The animated Clawd pets in this folder come from
[clawd-pet](https://github.com/abderrahimghazali/clawd-pet) by Abderrahim Ghazali,
used under the MIT License (see `LICENSE` in this folder). 93 of its poses are
bundled: the ones the widget uses for moods, work, reactions, hobbies and
seasons.

Changes:

- `clawd-sleeping.svg`: `opacity="0.5"` on its ground shadow (it renders solid
  black in Qt's SVG renderer otherwise) and the shared `viewBox` (`-15 -25 45 45`),
  so Clawd's feet stay in place when he changes pose.
- `clawd-happy.svg`: the shared `viewBox` (its drawing already uses the same
  coordinates).
- All pets were run through `tools/bake_pet_origins.py`. It replaces CSS
  `transform-origin` (in the stylesheet or inline) with wrapper groups (move to
  the pivot, animate, move back), because Qt's renderer applies
  `transform-origin` wrongly on animated groups (limbs flew off the character).
  The drawings and animations are otherwise unchanged, and browsers render the
  result the same way.

`notify-trophy.svg`, `notify-sad.svg`, `notify-error.svg` (`viewBox="-4 -4 24 24"`)
and `notify-oncall.svg` (`viewBox="-6 -8 27 27"`, to keep its warning sign) are
copies of the matching pets with a tighter `viewBox`, so Clawd fills a
notification icon.
