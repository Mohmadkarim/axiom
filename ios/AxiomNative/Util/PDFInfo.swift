import PDFKit
import UIKit

enum PDFInfo {
    struct Info { let pages: Int; let title: String?; let author: String?; let cover: String? }
    static func read(_ data: Data) -> Info? {
        guard let doc = PDFDocument(data: data) else { return nil }
        let attrs = doc.documentAttributes ?? [:]
        var cover: String?
        if let p = doc.page(at: 0) {
            let img = p.thumbnail(of: CGSize(width: 360, height: 480), for: .mediaBox)
            cover = img.jpegData(compressionQuality: 0.78)?.dataURL(mime: "image/jpeg")
        }
        return Info(pages: doc.pageCount, title: attrs[PDFDocumentAttribute.titleAttribute] as? String, author: attrs[PDFDocumentAttribute.authorAttribute] as? String, cover: cover)
    }
}

extension UIImage {
    static func fromDataURL(_ s: String?) -> UIImage? { s?.dataURLBytes.flatMap(UIImage.init(data:)) }
}
