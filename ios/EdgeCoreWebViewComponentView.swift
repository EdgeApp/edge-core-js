import Foundation
import React
import UIKit

@objc(EdgeCoreWebViewComponentView)
class EdgeCoreWebViewComponentView: RCTViewComponentView {
    private let webView = EdgeCoreWebView()
    
    override init(frame: CGRect) {
        super.init(frame: frame)
        addSubview(webView)
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    override func layoutSubviews() {
        super.layoutSubviews()
        webView.frame = bounds
    }
    
    override func updateProps(_ props: Props) {
        if let allowDebugging = props["allowDebugging"] as? Bool {
            webView.allowDebugging = allowDebugging
        }
        
        if let source = props["source"] as? String {
            webView.source = source
        }
    }
    
    override func handleCommand(_ commandName: String, args: [Any]) {
        if commandName == "runJs", let js = args.first as? String {
            webView.runJs(js: js)
        }
    }
    
    func sendMessageEvent(message: String) {
        if let eventEmitter = eventEmitter as? RCTEventEmitterProtocol {
            eventEmitter.dispatchEvent(
                for: self,
                type: "onMessage",
                payload: ["message": message]
            )
        }
    }
    
    func sendScriptErrorEvent(source: String) {
        if let eventEmitter = eventEmitter as? RCTEventEmitterProtocol {
            eventEmitter.dispatchEvent(
                for: self,
                type: "onScriptError", 
                payload: ["source": source]
            )
        }
    }
}