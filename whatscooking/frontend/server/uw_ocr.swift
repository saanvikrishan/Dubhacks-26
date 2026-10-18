// Local Apple Vision fallback for UW PDFs whose dish text is embedded in images.
// Usage: swift server/uw_ocr.swift input.pdf output.json
import Foundation
import CoreGraphics
import Vision
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let doc = CGPDFDocument(url as CFURL) else { fatalError("Invalid PDF") }
var pages: [[String: Any]] = []
for index in 1...doc.numberOfPages {
 guard let page = doc.page(at: index) else { fatalError("Missing page") }
 let box = page.getBoxRect(.mediaBox)
 let scale: CGFloat = 1.5
 let width = Int(box.width * scale), height = Int(box.height * scale)
 let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
 ctx.setFillColor(CGColor(gray: 1, alpha: 1));ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
 ctx.scaleBy(x: scale, y: scale);ctx.drawPDFPage(page)
 let request = VNRecognizeTextRequest()
 request.recognitionLevel = .accurate
 request.recognitionLanguages = ["en-US"]
 request.usesLanguageCorrection = false
 try VNImageRequestHandler(cgImage: ctx.makeImage()!, options: [:]).perform([request])
 let lines = (request.results ?? []).compactMap { observation -> [String: Any]? in
  guard let candidate = observation.topCandidates(1).first else { return nil }
  let b = observation.boundingBox
  return ["text": candidate.string, "confidence": candidate.confidence, "x": b.minX, "y": 1-b.maxY, "width": b.width, "height": b.height]
 }
 pages.append(["page": index, "lines": lines])
}
let data = try JSONSerialization.data(withJSONObject: ["method": "Apple Vision accurate en-US; manual review required", "pages": pages], options: [.prettyPrinted, .sortedKeys])
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
