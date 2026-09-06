import Foundation
import Capacitor
import StoreKit

/// StoreKit 2 による買い切り Pro アンロック。
/// JS からは `Capacitor.Plugins.Pro.getStatus() / purchase({productId}) / restore()` で呼ぶ。
/// 所有状態が変わると `proStatusChanged` イベントを notifyListeners で通知する。
@available(iOS 15.0, *)
@objc(ProPlugin)
public class ProPlugin: CAPPlugin {

    /// App Store Connect で作成する非消費型 In‑App Purchase の Product ID。
    /// z-pro.js の PRODUCT_ID と一致させること。
    private let productID = "com.kokisagawa.barcodetool.pro"

    private var updatesTask: Task<Void, Never>?

    override public func load() {
        // アプリ外（Ask to Buy 承認、家族共有、返金取り消し等）で起きる取引更新を購読
        updatesTask = Task.detached { [weak self] in
            guard let self = self else { return }
            for await update in Transaction.updates {
                await self.handle(update)
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    // MARK: - JS API

    @objc func getStatus(_ call: CAPPluginCall) {
        Task {
            let owned = await self.isOwned()
            let price = await self.priceString()
            call.resolve([
                "owned": owned,
                "price": price
            ])
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        let requested = call.getString("productId") ?? productID
        Task {
            do {
                let products = try await Product.products(for: [requested])
                guard let product = products.first else {
                    call.reject("product_not_found")
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let txn):
                        await txn.finish()
                        call.resolve(["owned": true])
                        self.notifyListeners("proStatusChanged", data: ["owned": true])
                    case .unverified:
                        call.resolve(["owned": false, "error": "unverified"])
                    }
                case .userCancelled:
                    let owned = await self.isOwned()
                    call.resolve(["owned": owned, "cancelled": true])
                case .pending:
                    call.resolve(["owned": false, "pending": true])
                @unknown default:
                    let owned = await self.isOwned()
                    call.resolve(["owned": owned])
                }
            } catch {
                call.reject("purchase_failed", nil, error)
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
            } catch {
                // sync 失敗でも currentEntitlements は見にいく
            }
            let owned = await self.isOwned()
            call.resolve(["owned": owned])
            self.notifyListeners("proStatusChanged", data: ["owned": owned])
        }
    }

    // MARK: - Helpers

    private func isOwned() async -> Bool {
        for await result in Transaction.currentEntitlements {
            if case .verified(let txn) = result,
               txn.productID == productID,
               txn.revocationDate == nil {
                return true
            }
        }
        return false
    }

    private func priceString() async -> String {
        do {
            let products = try await Product.products(for: [productID])
            return products.first?.displayPrice ?? ""
        } catch {
            return ""
        }
    }

    private func handle(_ result: VerificationResult<Transaction>) async {
        guard case .verified(let txn) = result else { return }
        await txn.finish()
        let owned = await isOwned()
        notifyListeners("proStatusChanged", data: ["owned": owned])
    }
}
