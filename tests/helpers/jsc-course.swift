import Foundation
import JavaScriptCore

let root = CommandLine.arguments[1]
let plugin = CommandLine.arguments[2]
let fm = FileManager.default
try fm.createDirectory(atPath: root, withIntermediateDirectories: true)
let video = root + "/lecture.mp4"
fm.createFile(atPath: video, contents: Data())
let main = JSContext()!
let global = JSContext()!
var mainMessages: [String: JSValue] = [:]
var globalMessages: [String: JSValue] = [:]
var timers: [Timer] = []
var fileStack: [String] = []
func configure(_ ctx: JSContext, _ label: String) {
  ctx.exceptionHandler = { _, value in print("EXCEPTION \(label): \(value?.toString() ?? "nil") \(value?.objectForKeyedSubscript("stack")?.toString() ?? "")") }
  let printBlock: @convention(block) (JSValue) -> Void = { print("\(label): \($0.toString() ?? "nil")") }
  ctx.setObject(printBlock, forKeyedSubscript: "__print" as NSString)
  let exists: @convention(block) (String) -> Bool = { fm.fileExists(atPath: $0) }
  let read: @convention(block) (String) -> String = { (try? String(contentsOfFile: $0, encoding: .utf8)) ?? "" }
  let write: @convention(block) (String, String) -> Void = { path, text in do { try text.write(toFile: path, atomically: true, encoding: .utf8) } catch { print("WRITE ERROR: \(error)") } }
  let move: @convention(block) (String, String) -> Int = { from, to in do { if fm.fileExists(atPath: to) { try fm.removeItem(atPath: to) }; try fm.moveItem(atPath: from, toPath: to); return 0 } catch { print(error); return 1 } }
  let timeout: @convention(block) (JSValue, Double) -> Void = { callback, ms in
    DispatchQueue.main.async {
      let timer = Timer.scheduledTimer(withTimeInterval: ms/1000, repeats: false) { _ in callback.call(withArguments: []) }
      timers.append(timer)
    }
  }
  let require: @convention(block) (String) -> JSValue? = { path in
    let parent = fileStack.last.map { URL(fileURLWithPath: $0).deletingLastPathComponent().path } ?? plugin
    let full = URL(fileURLWithPath: parent).appendingPathComponent(path).standardized.path
    guard let text = try? String(contentsOfFile: full, encoding: .utf8) else { print("MISSING \(full)"); return nil }
    fileStack.append(full)
    defer { fileStack.removeLast() }
    return ctx.evaluateScript("(function(){ const module={};\n" + text + "\nreturn module.exports; })()")
  }
  ctx.setObject(exists, forKeyedSubscript: "__exists" as NSString)
  ctx.setObject(read, forKeyedSubscript: "__read" as NSString)
  ctx.setObject(write, forKeyedSubscript: "__write" as NSString)
  ctx.setObject(move, forKeyedSubscript: "__move" as NSString)
  ctx.setObject(timeout, forKeyedSubscript: "setTimeout" as NSString)
  ctx.setObject(require, forKeyedSubscript: "require" as NSString)
}
configure(global, "GLOBAL")
configure(main, "MAIN")
let globalOn: @convention(block) (String, JSValue) -> Void = { globalMessages[$0] = $1 }
let mainOn: @convention(block) (String, JSValue) -> Void = { mainMessages[$0] = $1 }
let sendToGlobal: @convention(block) (String, JSValue) -> Void = { name, payload in
  print("M -> G \(name)")
  let data = JSValue(object: payload.toObject(), in: global)!
  globalMessages[name]?.call(withArguments: [data, "native-player"])
}
let sendToMain: @convention(block) (String, String, JSValue) -> Void = { label, name, payload in
  print("G -> M \(name): \(payload.toString() ?? "nil")")
  let data = JSValue(object: payload.toObject(), in: main)!
  mainMessages[name]?.call(withArguments: [data, NSNull()])
}
global.setObject(globalOn, forKeyedSubscript: "__globalOn" as NSString)
global.setObject(sendToMain, forKeyedSubscript: "__sendToMain" as NSString)
main.setObject(mainOn, forKeyedSubscript: "__mainOn" as NSString)
main.setObject(sendToGlobal, forKeyedSubscript: "__sendToGlobal" as NSString)
let rootJSON = String(data: try JSONSerialization.data(withJSONObject: root, options: [.fragmentsAllowed]), encoding: .utf8)!
global.evaluateScript("var root=" + rootJSON + "; var iina={file:{exists:__exists,read:__read,write:__write},utils:{resolvePath:()=>root+'/drafts.json',exec:async (_,args)=>({status:__move(args[1],args[2]),stderr:''})},global:{onMessage:__globalOn,postMessage:__sendToMain}};")
fileStack.append(plugin + "/global.js")
global.evaluateScript(try String(contentsOfFile: plugin + "/global.js", encoding: .utf8))
fileStack.removeLast()
main.evaluateScript("var root=" + rootJSON + "; var handlers={}, events={}, states=[]; var view={onMessage:(n,f)=>handlers[n]=f,postMessage:(n,p)=>{if(n==='state'){states.push(p);__print(JSON.stringify({status:p.status,error:p.error,binding:p.binding}));}},loadFile:()=>{handlers={};},show:()=>{},hide:()=>{},open:()=>{},close:()=>{},setProperty:()=>{},setFrame:()=>{}}; var iina={file:{exists:__exists},utils:{ask:()=>true},core:{window:{loaded:true},status:{idle:false,url:'file://'+root+'/lecture.mp4',position:7},pause:()=>{},seekTo:()=>{}},event:{on:(n,f)=>{events[n]=f;return n},off:()=>{}},input:{normalizeKeyCode:k=>k,getAllKeyBindings:()=>({}),onKeyDown:()=>{},PRIORITY_LOW:0},menu:{item:()=>({}),addItem:()=>{}},sidebar:view,standaloneWindow:{...view},global:{onMessage:__mainOn,postMessage:__sendToGlobal}};")
fileStack.append(plugin + "/main.js")
main.evaluateScript(try String(contentsOfFile: plugin + "/main.js", encoding: .utf8))
fileStack.removeLast()
main.evaluateScript("handlers['ui-ready']({view:'sidebar'});")
RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
main.evaluateScript("handlers['choose-course']({useCurrent:true});")
RunLoop.current.run(until: Date(timeIntervalSinceNow: 1))
guard main.evaluateScript("states[states.length-1].status")!.toString()! == "ready" else {
  print("Course creation did not reach ready")
  exit(1)
}
main.evaluateScript("var token=states[states.length-1].editorContext; handlers['draft-change']({text:'Nội dung đã lưu',editorContext:token});handlers['save-note']({editorContext:token});")
RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.5))
let courseData = try Data(contentsOf: URL(fileURLWithPath: root + "/.iina-notes.json"))
let courseDoc = try JSONSerialization.jsonObject(with: courseData) as! [String: Any]
let savedNotes = courseDoc["notes"] as! [[String: Any]]
guard savedNotes.count == 1, savedNotes[0]["text"] as? String == "Nội dung đã lưu",
      main.evaluateScript("states[states.length-1].saving")!.toBool() == false else {
  print("Save round-trip did not finish")
  exit(2)
}
fm.createFile(atPath: root + "/other.mp4", contents: Data())
main.evaluateScript("iina.core.status.url='file://'+root+'/other.mp4'; events['iina.file-started']();")
RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
main.evaluateScript("handlers['draft-change']({text:'Nháp giữ khi đóng',editorContext:token});events['iina.window-will-close']();")
RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.5))
let draftData = try Data(contentsOf: URL(fileURLWithPath: root + "/drafts.json"))
let draftDoc = try JSONSerialization.jsonObject(with: draftData) as! [String: Any]
let drafts = draftDoc["drafts"] as! [[String: Any]]
guard drafts.contains(where: { $0["text"] as? String == "Nháp giữ khi đóng" }) else {
  print("Closing before the deferred turn lost the latest draft")
  exit(3)
}
print("JSC COURSE READY; NOTE SAVED; FINAL DRAFT RETAINED")
