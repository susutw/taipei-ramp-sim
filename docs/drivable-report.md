# 自動試開驗證報告

由 `node scripts/check-drivable.mjs` 產生，請勿手動編輯。

- 自動任務：**149 / 165（90%）** 個出入口可以自動試開
- 手寫任務：`jianguo-changan-renai` ✅

## 失敗原因統計

| 原因 | 數量 |
|---|---|
| 找不到匝道口前的道路 | 5 |
| 找不到路線 | 4 |
| 找不到匝道接上的主線 | 3 |
| 匝道的起點或終點不明 | 2 |
| 場景裡找不到這個匝道 | 2 |

## 無法自動試開的出入口

| 出入口 | 區域 | 原因 |
|---|---|---|
| [環河快速道路 北向入口](https://sudosu.tw/taipei-ramp-sim/#r51919166) `r51919166` | area-02 | 找不到匝道口前的道路 |
| [信義快速道路 → 信義快速道路（南向）](https://sudosu.tw/taipei-ramp-sim/#r771821817) `r771821817` | area-04 | 匝道的起點或終點不明 |
| [建國高架 → 建國高架（東向）](https://sudosu.tw/taipei-ramp-sim/#r49695619) `r49695619` | area-05 | 找不到匝道接上的主線 |
| [建國高架 → 建國高架（北向）](https://sudosu.tw/taipei-ramp-sim/#r1456622325) `r1456622325` | area-05 | 場景裡找不到這個匝道 |
| [建國高架 → 建國高架（南向）](https://sudosu.tw/taipei-ramp-sim/#r1456622314) `r1456622314` | area-05 | 找不到匝道接上的主線 |
| [環河快速道路 → 水源快速道路（南向）](https://sudosu.tw/taipei-ramp-sim/#r229771727) `r229771727` | area-07 | 找不到路線 |
| [水源快速道路 東向入口](https://sudosu.tw/taipei-ramp-sim/#r302126383) `r302126383` | area-07 | 找不到匝道口前的道路 |
| [水源快速道路 東向入口](https://sudosu.tw/taipei-ramp-sim/#r713597831) `r713597831` | area-07 | 找不到匝道口前的道路 |
| [蔣渭水高速公路 → 蔣渭水高速公路（東向）](https://sudosu.tw/taipei-ramp-sim/#r553078200) `r553078200` | area-09 | 場景裡找不到這個匝道 |
| [水源快速道路 → 水源快速道路（西向）](https://sudosu.tw/taipei-ramp-sim/#r302089868) `r302089868` | area-10 | 找不到路線 |
| [市民高架 → 市民高架（東向）](https://sudosu.tw/taipei-ramp-sim/#r48793406) `r48793406` | area-13 | 找不到路線 |
| [信義快速道路 → 信義快速道路（南向）](https://sudosu.tw/taipei-ramp-sim/#r771835293) `r771835293` | area-14 | 匝道的起點或終點不明 |
| [環東大道 → 環東大道（東向）](https://sudosu.tw/taipei-ramp-sim/#r75844177) `r75844177` | area-15 | 找不到匝道接上的主線 |
| [市民高架 西向入口](https://sudosu.tw/taipei-ramp-sim/#r313332505) `r313332505` | area-17 | 找不到匝道口前的道路 |
| [國道3號 東向入口](https://sudosu.tw/taipei-ramp-sim/#r297475550) `r297475550` | area-20 | 找不到匝道口前的道路 |
| [洲美快速道路 → 洲美快速道路（北向）](https://sudosu.tw/taipei-ramp-sim/#r137326781) `r137326781` | area-32 | 找不到路線 |
