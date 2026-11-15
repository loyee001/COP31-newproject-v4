# UTCI 数值验证记录

本记录仅验证公式移植与输入边界，不验证合成校园或合成天气的现实预测能力。

## 公式与来源

实现为 UTCI 操作性六阶多项式近似（原始版本 a0.002，2009 年 10 月；Bröde et al., 2012）。源码 `src/thermal.js` 采用 pythermalcomfort 的完整多项式与 Hardy 饱和水汽压换算，保留完整 MIT 许可证。

- [UTCI 官方源代码 ZIP](https://utci.org/resources/UTCI%20Program%20Code.zip)
- [pythermalcomfort 固定提交 f9027dc0cb246c5e087f9d7a425aea1ceba5235b](https://github.com/pythermalcomfort/pythermalcomfort/blob/f9027dc0cb246c5e087f9d7a425aea1ceba5235b/pythermalcomfort/models/utci.py)
- [独立计算参考 ECMWF thermofeel](https://github.com/ecmwf/thermofeel/blob/master/thermofeel/thermofeel.py)

下载参考源代码后记录 SHA256，见 `tests/reference/utci-source-provenance.json`。参考源代码下载用于核对，不是运行网页时的网络依赖。

## 已运行的核对

1. 将官方 Fortran 与移植源的表达式解析为 `(Ta次数, 风速次数, 辐射温差次数, 水汽压次数)` 的系数映射。共 210 个不同单项式、最高总次数 6；最大系数差 `2.168404344971009×10⁻¹⁹`，为十进制常数到二进制浮点的舍入差。记录在 `utci-coefficients-check.json`。
2. 使用独立 ECMWF thermofeel 的 `calculate_utci_polynomial` 与 `calculate_saturation_vapour_pressure` 生成 800 组有效参考值。只执行这两个数学函数，未执行其模块中的其他代码。输入组合覆盖气温 −50 至 50°C，辐射温差 −30 至 70°C，风速 0.5、1、5、17 m/s，相对湿度 0、25、50、100%；水汽压超过 5 kPa 的组合按适用域排除。
3. JavaScript 对全部 800 组参考值的最大绝对差为 `3.268496584496461×10⁻¹³ °C`。测试容差为 `2×10⁻⁸ °C`，避免不同运行时的浮点舍入差异。
4. pythermalcomfort 文档示例 `Ta=Tmrt=25°C, v10m=1m/s, RH=50%` 得 `24.612126260346333°C`，四舍五入一位小数为 `24.6°C`。
5. 覆盖气温、辐射温差、风速、相对湿度、水汽压的超限输入，非有限值与缺失输入；确认返回 `value:null, valid:false`，不会静默截断。另覆盖有效范围端点、hPa/kPa 换算和默认夏季条件下的遮荫对比。

6. 精确 5 kPa 的相对湿度换算可能产生 `5.000000000000001`；仅此数值舍入使用 `10⁻¹² kPa` 容差，确保合法端点可计算，同时确认 `5+10⁻⁹ kPa` 仍被拒绝。

运行 `node --test tests/thermal.test.mjs` 可复核 7 项测试。测试文件中的 800 组参考值为独立实现输出，并非用当前 JavaScript 自己生成预期值。

## 重建参考值

从上述 ECMWF 地址取得与记录 SHA256 一致的参考源文件后，运行：

```sh
python3 tests/reference/regenerate-fixtures.py /path/to/thermofeel.py
node --test tests/thermal.test.mjs
```

复现脚本会拒绝哈希不一致的文件。更新参考库版本时应先重新审阅公式，更新来源记录与参考值后再运行测试。
