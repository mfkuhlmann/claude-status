import QtQuick
import QtQuick.VectorImage

// A pet's pose as an animated vector image. It needs Qt 6.10 (VectorImage
// animations) and the QtQuick.VectorImage module, so Pet.qml only loads it
// where root.animatedPets says it works, and shows a still image elsewhere.
VectorImage {
    property bool playing: true
    fillMode: VectorImage.PreserveAspectFit
    animations.loops: Animation.Infinite
    animations.paused: !playing
    assumeTrustedSource: true
}
