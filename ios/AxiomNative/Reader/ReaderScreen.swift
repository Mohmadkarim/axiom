import SwiftUI

struct ReaderScreen: View {
    let bookID: String
    var startPage: Int?
    @Environment(AppState.self) private var app
    var body: some View {
        ZStack { Theme.bg; Button("Back") { app.close() } }.ignoresSafeArea()
    }
}
