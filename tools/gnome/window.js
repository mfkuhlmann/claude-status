// A plain window titled ARGV[0], standing in for a terminal in the jump test
// of tools/gnome/steps-actions.sh (the container can't run real terminals).
imports.gi.versions.Gtk = '4.0';
const {GLib, Gtk} = imports.gi;

Gtk.init();
const window = new Gtk.Window({title: ARGV[0], default_width: 420, default_height: 260});
window.set_child(new Gtk.Label({label: ARGV[0]}));
window.present();
new GLib.MainLoop(null, false).run();
