// GNOME Shell 43/44 stand-ins for the GNOME 45+ APIs the extension uses
// (gnome/port43.py points the converted code here). Legacy imports: this
// file is copied into the built extension as it is.

const MessageTray = imports.ui.messageTray;
const ExtensionUtils = imports.misc.extensionUtils;

// The GNOME 45+ Extension base class: uuid, path, metadata, getSettings(),
// openPreferences(). init() hands it the extension's meta object.
var Extension = class Extension {
    constructor(meta) {
        this.metadata = meta.metadata;
        this.uuid = meta.uuid;
        this.path = meta.path;
        this.dir = meta.dir;
    }

    getSettings(schema) {
        return ExtensionUtils.getSettings(schema);
    }

    openPreferences() {
        ExtensionUtils.openPrefs();
    }
};

// new MessageTray.Source({title, icon}) of GNOME 46+: here the constructor
// takes (title, iconName), and the icon comes from getIcon()
function newSource({title, icon = null}) {
    const source = new MessageTray.Source(title, null);
    if (icon)
        source.getIcon = () => icon;
    return source;
}

// new MessageTray.Notification({source, title, body, gicon}) of GNOME 46+:
// here (source, title, banner, params), and params takes only known keys
function newNotification({source, title, body = '', gicon = null}) {
    return new MessageTray.Notification(source, title, body, {gicon});
}
