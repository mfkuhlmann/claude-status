import QtQuick
import org.kde.kirigami as Kirigami

// Asks before a shared chat is kept on one account only (the others lose it)
Kirigami.InlineMessage {
    type: Kirigami.MessageType.Warning
    text: i18n("Keep “%1” only on %2? It leaves the chat lists of %3; the conversation stays on %2. It can't be open in a session meanwhile.",
               root.shareConfirm.name, root.shareConfirm.account, root.shareConfirm.others)
    actions: [
        Kirigami.Action {
            text: i18n("Keep only on %1", root.shareConfirm.account)
            icon.name: "list-remove"
            onTriggered: root.confirmKeepOnly()
        },
        Kirigami.Action {
            text: i18n("Cancel")
            onTriggered: root.shareConfirm = { key: "", chatId: "", name: "", profileKey: "", account: "", others: "" }
        }
    ]
}
