#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Capacitor に "Pro" プラグインとメソッドを登録する。
// （Swift 側 @objc(ProPlugin) と名前を一致させること）
CAP_PLUGIN(ProPlugin, "Pro",
    CAP_PLUGIN_METHOD(getStatus, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(purchase, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(restore, CAPPluginReturnPromise);
)
