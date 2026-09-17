# 产品主授权的 ground-truth 修正（对应契约 r3）

日期：2026-09-17；执行：R4；授权：本任务产品主明确允许修正与生效契约矛盾的标注及生成器，要求独立提交、列举前后值、生成确定性验证及 Gate 3 复核。此例外不改变 R6 对 tests/golden 的所有权。

## 依据与验证方法

- 契约 `docs/interface-contract.md:283`、`:284`、`:285`：先按原始像素做膨胀/近邻分组，再按组原始总面积过滤；bbox gap=0 也在正距离阈值内。
- 同文档 `:166`、`:168`、`:170`、`:172`：离群中位数、dHash按实际bbox、几何排序、原始组件来源与merged标记。
- §4.2 `:314`、`:318`、`:319`、`:323`：降级原因优先级、EMPTY_INPUT特例、其他降级公式、建议网格实际帧。
- §13.2 `:1013`、`:1014` 与 §13.3 `:1024`～`:1032`：仅全透明自动检测固定1×1，非全透明无有效候选仍走通用公式；显式手动配置不被覆盖。
- 证据脚本 `tools/audit-r3.mjs` 使用独立8邻域flood-fill、逐像素方形膨胀、集合图遍历，不导入管线src/dist，也不读取管线预测输出。生成器中的修正是经该证据核对的显式几何常量，不从被测检测器自动更新答案。
- 原20张PNG保持字节不变；配额仍20；IoU>0.9、帧数、flags、warning集合、hash等价断言不降低门槛。

## 降级用例一次性排查

18：原始主体1个，膨胀与近邻合并后仍1组，N=1。96/80=1.2，columns=ceil(sqrt(1.2))=2，rows=ceil(1/2)=1。由原1×1、1帧改为2列×1行、2帧，切点x=[0,48,96]；reason保持INSUFFICIENT_COMPONENTS，attempted保持[grid,components]。两个sourceRect分别[0,0,48,80]、[48,0,48,80]，紧框由原主体与两半矩形相交独立求得。

19：原始3个组件：外环bbox=[6,6,116,116]，内主体bbox=[27,29,17,19]，内条块bbox=[68,72,34,11]。半径1膨胀后三者尚分离；短边中位数为17，默认近邻距离round(17×.15)=3。外环bbox包含内部两个bbox，gap=0<3，因此按近邻规则链式合并为1组，原始面积3326，过滤阈值4。有效N=1，128×128通用公式得到1×1、1帧；原4帧/AMBIGUOUS_COMPONENTS改为1帧/INSUFFICIENT_COMPONENTS。返回的是建议手动整图框，merged=false，multipleComponents=true；不是把内部合并候选直接当最终帧。原用例标题/覆盖声明与该几何事实不符，一并纠正，稳定caseId保留。

20：原始alpha全0；按§13.2固定1×1，恰好1空帧。标注、PNG、reason=EMPTY_INPUT、attempted=[]均不变。

## 其他与生效契约矛盾的历史标注

07/10/11/12/15/16的生成器使用disruptGridProjection加白色断槽点，但旧标注仍直接采用加点前主体矩形。部分点与主体原始连通或在半径1膨胀后连通。先过滤小点再分组会违反§4.1（:283～:285），因此按现有PNG修正紧框、几何排序与merged来源；不删除噪点、不修改输入，也不改变算法迎合旧标注。这些规则在r2已存在，本次是按照已生效r3核对出的历史标注错误，并非声称r3新改变了膨胀规则。

15仍保留5帧、duplicateOf=null；原hash等价组[0,1,2,3,4]中的中间3帧已被断槽点改变，不能要求实际bbox内容hash相同。保留严格等价组[0,4]，独立脚本逐RGBA证明二者裁剪内容完全一致；未移除重复帧验收。

## 逐例修改前后值

以下数组中的矩形顺序均为[x,y,width,height]；flags变化完整列出；未列出的字段保持原值。

### 07-scatter-5

修改前：

```json
{
  "frameCount": 5,
  "layout": null,
  "degraded": null,
  "sourceRects": [
    [
      70,
      5,
      24,
      24
    ],
    [
      10,
      10,
      24,
      24
    ],
    [
      40,
      18,
      24,
      24
    ],
    [
      90,
      38,
      24,
      24
    ],
    [
      58,
      47,
      24,
      24
    ]
  ],
  "bboxes": [
    [
      70,
      5,
      24,
      24
    ],
    [
      10,
      10,
      24,
      24
    ],
    [
      40,
      18,
      24,
      24
    ],
    [
      90,
      38,
      24,
      24
    ],
    [
      58,
      47,
      24,
      24
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [],
  "hashEqualityGroups": []
}
```

修改后：

```json
{
  "frameCount": 5,
  "layout": null,
  "degraded": null,
  "sourceRects": [
    [
      70,
      5,
      24,
      24
    ],
    [
      8,
      10,
      29,
      24
    ],
    [
      40,
      18,
      24,
      24
    ],
    [
      90,
      38,
      24,
      24
    ],
    [
      58,
      47,
      24,
      24
    ]
  ],
  "bboxes": [
    [
      70,
      5,
      24,
      24
    ],
    [
      8,
      10,
      29,
      24
    ],
    [
      40,
      18,
      24,
      24
    ],
    [
      90,
      38,
      24,
      24
    ],
    [
      58,
      47,
      24,
      24
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [],
  "hashEqualityGroups": []
}
```

### 10-detached-weapons

修改前：

```json
{
  "frameCount": 4,
  "layout": null,
  "degraded": null,
  "sourceRects": [
    [
      12,
      35,
      24,
      29
    ],
    [
      92,
      35,
      24,
      29
    ],
    [
      52,
      38,
      24,
      29
    ],
    [
      132,
      38,
      24,
      29
    ]
  ],
  "bboxes": [
    [
      12,
      35,
      24,
      29
    ],
    [
      92,
      35,
      24,
      29
    ],
    [
      52,
      38,
      24,
      29
    ],
    [
      132,
      38,
      24,
      29
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": true,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": true,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": true,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": true,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [
    "MULTIPLE_COMPONENTS"
  ],
  "hashEqualityGroups": []
}
```

修改后：

```json
{
  "frameCount": 4,
  "layout": null,
  "degraded": null,
  "sourceRects": [
    [
      90,
      32,
      26,
      32
    ],
    [
      12,
      35,
      24,
      29
    ],
    [
      52,
      38,
      24,
      30
    ],
    [
      130,
      38,
      26,
      29
    ]
  ],
  "bboxes": [
    [
      90,
      32,
      26,
      32
    ],
    [
      12,
      35,
      24,
      29
    ],
    [
      52,
      38,
      24,
      30
    ],
    [
      130,
      38,
      26,
      29
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": true,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": true,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": true,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": true,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [
    "MULTIPLE_COMPONENTS"
  ],
  "hashEqualityGroups": []
}
```

### 11-noise-speckles

修改前：

```json
{
  "frameCount": 5,
  "layout": null,
  "degraded": null,
  "sourceRects": [
    [
      73,
      8,
      22,
      26
    ],
    [
      8,
      12,
      22,
      26
    ],
    [
      40,
      20,
      22,
      26
    ],
    [
      101,
      42,
      22,
      26
    ],
    [
      57,
      53,
      22,
      26
    ]
  ],
  "bboxes": [
    [
      73,
      8,
      22,
      26
    ],
    [
      8,
      12,
      22,
      26
    ],
    [
      40,
      20,
      22,
      26
    ],
    [
      101,
      42,
      22,
      26
    ],
    [
      57,
      53,
      22,
      26
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [],
  "hashEqualityGroups": []
}
```

修改后：

```json
{
  "frameCount": 5,
  "layout": null,
  "degraded": null,
  "sourceRects": [
    [
      73,
      8,
      22,
      26
    ],
    [
      8,
      12,
      25,
      26
    ],
    [
      40,
      20,
      22,
      26
    ],
    [
      101,
      42,
      23,
      26
    ],
    [
      57,
      53,
      22,
      26
    ]
  ],
  "bboxes": [
    [
      73,
      8,
      22,
      26
    ],
    [
      8,
      12,
      25,
      26
    ],
    [
      40,
      20,
      22,
      26
    ],
    [
      101,
      42,
      23,
      26
    ],
    [
      57,
      53,
      22,
      26
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [],
  "hashEqualityGroups": []
}
```

### 12-noise-clusters

修改前：

```json
{
  "frameCount": 5,
  "layout": null,
  "degraded": null,
  "sourceRects": [
    [
      73,
      8,
      22,
      26
    ],
    [
      8,
      12,
      22,
      26
    ],
    [
      40,
      20,
      22,
      26
    ],
    [
      101,
      42,
      22,
      26
    ],
    [
      57,
      53,
      22,
      26
    ]
  ],
  "bboxes": [
    [
      73,
      8,
      22,
      26
    ],
    [
      8,
      12,
      22,
      26
    ],
    [
      40,
      20,
      22,
      26
    ],
    [
      101,
      42,
      22,
      26
    ],
    [
      57,
      53,
      22,
      26
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [],
  "hashEqualityGroups": []
}
```

修改后：

```json
{
  "frameCount": 5,
  "layout": null,
  "degraded": null,
  "sourceRects": [
    [
      73,
      8,
      25,
      26
    ],
    [
      8,
      12,
      23,
      26
    ],
    [
      38,
      20,
      24,
      26
    ],
    [
      101,
      42,
      22,
      26
    ],
    [
      57,
      53,
      22,
      26
    ]
  ],
  "bboxes": [
    [
      73,
      8,
      25,
      26
    ],
    [
      8,
      12,
      23,
      26
    ],
    [
      38,
      20,
      24,
      26
    ],
    [
      101,
      42,
      22,
      26
    ],
    [
      57,
      53,
      22,
      26
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [],
  "hashEqualityGroups": []
}
```

### 15-repeated-frames

修改前：

```json
{
  "frameCount": 5,
  "layout": null,
  "degraded": null,
  "sourceRects": [
    [
      78,
      7,
      24,
      28
    ],
    [
      10,
      10,
      24,
      28
    ],
    [
      43,
      18,
      24,
      28
    ],
    [
      111,
      26,
      24,
      28
    ],
    [
      59,
      54,
      24,
      28
    ]
  ],
  "bboxes": [
    [
      78,
      7,
      24,
      28
    ],
    [
      10,
      10,
      24,
      28
    ],
    [
      43,
      18,
      24,
      28
    ],
    [
      111,
      26,
      24,
      28
    ],
    [
      59,
      54,
      24,
      28
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [],
  "hashEqualityGroups": [
    [
      0,
      1,
      2,
      3,
      4
    ]
  ]
}
```

修改后：

```json
{
  "frameCount": 5,
  "layout": null,
  "degraded": null,
  "sourceRects": [
    [
      78,
      7,
      24,
      28
    ],
    [
      8,
      10,
      29,
      28
    ],
    [
      40,
      18,
      27,
      28
    ],
    [
      111,
      26,
      25,
      28
    ],
    [
      59,
      54,
      24,
      28
    ]
  ],
  "bboxes": [
    [
      78,
      7,
      24,
      28
    ],
    [
      8,
      10,
      29,
      28
    ],
    [
      40,
      18,
      27,
      28
    ],
    [
      111,
      26,
      25,
      28
    ],
    [
      59,
      54,
      24,
      28
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [],
  "hashEqualityGroups": [
    [
      0,
      4
    ]
  ]
}
```

### 16-size-outlier

修改前：

```json
{
  "frameCount": 5,
  "layout": null,
  "degraded": null,
  "sourceRects": [
    [
      70,
      8,
      20,
      28
    ],
    [
      10,
      13,
      20,
      28
    ],
    [
      39,
      24,
      20,
      28
    ],
    [
      99,
      34,
      20,
      28
    ],
    [
      128,
      50,
      40,
      56
    ]
  ],
  "bboxes": [
    [
      70,
      8,
      20,
      28
    ],
    [
      10,
      13,
      20,
      28
    ],
    [
      39,
      24,
      20,
      28
    ],
    [
      99,
      34,
      20,
      28
    ],
    [
      128,
      50,
      40,
      56
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": true,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [
    "OUTLIER_FRAMES"
  ],
  "hashEqualityGroups": []
}
```

修改后：

```json
{
  "frameCount": 5,
  "layout": null,
  "degraded": null,
  "sourceRects": [
    [
      70,
      8,
      20,
      28
    ],
    [
      8,
      13,
      25,
      28
    ],
    [
      36,
      24,
      23,
      28
    ],
    [
      99,
      34,
      23,
      28
    ],
    [
      128,
      50,
      43,
      56
    ]
  ],
  "bboxes": [
    [
      70,
      8,
      20,
      28
    ],
    [
      8,
      13,
      25,
      28
    ],
    [
      36,
      24,
      23,
      28
    ],
    [
      99,
      34,
      23,
      28
    ],
    [
      128,
      50,
      43,
      56
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": true,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": true,
      "merged": true,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [
    "OUTLIER_FRAMES"
  ],
  "hashEqualityGroups": []
}
```

### 18-single-frame-degrade

修改前：

```json
{
  "frameCount": 1,
  "layout": {
    "rows": 1,
    "columns": 1
  },
  "degraded": {
    "reason": "INSUFFICIENT_COMPONENTS",
    "attempted": [
      "grid",
      "components"
    ]
  },
  "sourceRects": [
    [
      0,
      0,
      96,
      80
    ]
  ],
  "bboxes": [
    [
      22,
      13,
      51,
      54
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [
    "DETECTION_DEGRADED"
  ],
  "hashEqualityGroups": []
}
```

修改后：

```json
{
  "frameCount": 2,
  "layout": {
    "rows": 1,
    "columns": 2
  },
  "degraded": {
    "reason": "INSUFFICIENT_COMPONENTS",
    "attempted": [
      "grid",
      "components"
    ]
  },
  "sourceRects": [
    [
      0,
      0,
      48,
      80
    ],
    [
      48,
      0,
      48,
      80
    ]
  ],
  "bboxes": [
    [
      22,
      13,
      26,
      54
    ],
    [
      48,
      13,
      25,
      54
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [
    "DETECTION_DEGRADED"
  ],
  "hashEqualityGroups": []
}
```

### 19-ambiguous-degrade

修改前：

```json
{
  "frameCount": 4,
  "layout": {
    "rows": 2,
    "columns": 2
  },
  "degraded": {
    "reason": "AMBIGUOUS_COMPONENTS",
    "attempted": [
      "grid",
      "components"
    ]
  },
  "sourceRects": [
    [
      0,
      0,
      64,
      64
    ],
    [
      64,
      0,
      64,
      64
    ],
    [
      0,
      64,
      64,
      64
    ],
    [
      64,
      64,
      64,
      64
    ]
  ],
  "bboxes": [
    [
      6,
      6,
      58,
      58
    ],
    [
      64,
      6,
      58,
      58
    ],
    [
      6,
      64,
      58,
      58
    ],
    [
      64,
      64,
      58,
      58
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": true,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": false,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    },
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": true,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [
    "DETECTION_DEGRADED",
    "MULTIPLE_COMPONENTS"
  ],
  "hashEqualityGroups": []
}
```

修改后：

```json
{
  "frameCount": 1,
  "layout": {
    "rows": 1,
    "columns": 1
  },
  "degraded": {
    "reason": "INSUFFICIENT_COMPONENTS",
    "attempted": [
      "grid",
      "components"
    ]
  },
  "sourceRects": [
    [
      0,
      0,
      128,
      128
    ]
  ],
  "bboxes": [
    [
      6,
      6,
      116,
      116
    ]
  ],
  "flags": [
    {
      "outlier": false,
      "merged": false,
      "multipleComponents": true,
      "empty": false,
      "edited": false,
      "duplicateOf": null
    }
  ],
  "warningCodes": [
    "DETECTION_DEGRADED",
    "MULTIPLE_COMPONENTS"
  ],
  "hashEqualityGroups": []
}
```

### 20-empty-transparent

无变化；已核对符合生效契约。

## 复核责任

Gate 3 由 R6 作为验收执行手复核以上修改，包括第19例N=1的来源、噪点保留与merged标记、第15例等价组的RGBA证据及生成确定性。此记录不代替独立验收结论。

## 已执行验证

连续两次执行 `pnpm --filter @spriteflow/golden generate`，61个病例文件SHA-256逐项一致；20张PNG与修改前Git HEAD逐字节一致。生成器版本由1.0.0升至1.0.1。
