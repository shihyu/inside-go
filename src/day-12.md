# 第十二天：簡單除錯 GO 語言程式

- Day: 12
- 發佈日期: 2019-09-27
- 原文: [https://ithelp.ithome.com.tw/articles/10221613](https://ithelp.ithome.com.tw/articles/10221613)

### 前情提要

------------------------------------------------------------------------

`schedinit` 函式終於接近尾聲。昨日追蹤的是與 module、signal 相關的幾項初始化。

### `schedinit`

```go
 ...
    goargs()
    goenvs()
    parsedebugvars()
    ...
```

其餘的部份比較瑣碎，因此 `schedinit` 函式就看到這裡為止吧。

#### `goargs` 函式（在 `runtime/runtime1.go`）

> 不得不說筆者對於 `rintime1`、`runtime2` 這種命名實在極不欣賞，但顯然不可能有十全十美的設計，也許這麼命名也是有緣由的？之後再細究。

```go
func goargs() {
    if GOOS == "windows" {
        return
    }
    argslice = make([]string, argc)
    for i := int32(0); i < argc; i++ {
        argslice[i] = gostringnocopy(argv_index(argv, i))
    }
}
```

windows 系列不需要處理這個部份？為什麼？只是我們使用的 Linux 環境顯然不會進入這個路徑，所以就不理會了。處理命令列參數的 `argslice` 變數先透過 `make` 呼叫作成，然後引用 `argv_index` 這個我們之前也看過的函式來取得每一個參數字串的位址。至於如何不拷貝就建構出這個參數字串的 slice，就要看看 `gostringnocopy` 這個函式怎麼做了：（在 `runtime/string.go`）

```go
func gostringnocopy(str *byte) string {
    ss := stringStruct{str: unsafe.Pointer(str), len: findnull(str)}
    s := *(*string)(unsafe.Pointer(&ss))
    return s
}
```

先是使用傳入的 `byte` 陣列建構 `ss`、型別為 `stringStruct` 的變數，然後之後再用 `unsafe` 的手法取得指標，賦予成真正的 `string` 變數回傳。

#### `goenvs` 函式（`runtime/os_linux.go`）

`goenvs` 函式直接轉手呼叫了下面這個位在 `runtime/runtime1.go` 的函式：

```go
func goenvs_unix() {
    // TODO(austin): ppc64 in dynamic linking mode doesn't
    // guarantee env[] will immediately follow argv. Might cause
    // problems.
    n := int32(0)
    for argv_index(argv, argc+1+n) != nil {
        n++
    }

    envs = make([]string, n)
    for i := int32(0); i < n; i++ {
        envs[i] = gostring(argv_index(argv, argc+1+i))
    }
}
```

這在很之前就曾經看過類似的初始化了！初始化環境變數時，使用到的一個重要假設就是這裡最一開始的 TODO 所提到的**環境變數應該要直接跟在命令列參數後面**。這裡的邏輯與上述類似，但為什麼不用 `gostringnocopy` 的版本？

#### `parsedebugvar` 函式（`runtime/runtime1.go`）

這個函式解析 `GODEBUG` 和 `GOTRACEBACK` 環境變數，並依照指定的參數執行不同的除錯行為。首先第一個檢查的是 `GODEBUG`，透過一個指定初始值與中止條件、但並未指定迴圈前進條件的 for 迴圈：

```go
func parsedebugvars() {
    ...
        for p := gogetenv("GODEBUG"); p != ""; {
                field := ""
                i := index(p, ",")                                                                                                      
                if i < 0 {
                        field, p = p, ""
                } else {
                        field, p = p[:i], p[i+1:]
                }       
                i = index(field, "=")
                if i < 0 {
                        continue
                }      
                key, value := field[:i], field[i+1:]

```
這部份就是純粹的字串處理了。`p` 就是環境變數 `export GODEBUG=...` 的等號之後的一整段字串。由這個處理方式可知，`GODEBUG` 可以非常多功能的處理多組以逗號分隔、以等號賦值的 key-value 設定。至於哪些設定可以被接納呢？不妨參考[這份官方文件](https://golang.org/pkg/runtime/#pkg-overview)的 `Environment Variables` 一節。

筆者這裡挑選其中最簡單易懂的兩個選項出來玩玩看：`allocfreetrace`、`schedtrace`；前者是在每一次的記憶體配置與釋放時印出訊息，後者則是每隔一段時間印出 scheduler 的即時動態。先以以 hello world 程式為例看看前者的效應：

```
$ GODEBUG=allocfreetrace=1 ./hw
...
tracealloc(0xc0000941a0, 0xd0, map.bucket[string]*unicode.RangeTable)
goroutine 1 [running, locked to thread]:
runtime.mallocgc(0xd0, 0x4b0700, 0x1, 0xc000015438)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/malloc.go:1094 +0x4da fp=0xc00008ed48 sp=0xc00008eca8 pc=0x40b0ea
runtime.newobject(...)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/malloc.go:1151
runtime.(*hmap).newoverflow(0xc000092030, 0x4a4b00, 0xc000015320, 0xc0000940d0)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/map.go:262 +0x2b5 fp=0xc00008eda8 sp=0xc00008ed48 pc=0x40c315
runtime.mapassign_faststr(0x4a4b00, 0xc000092030, 0x4c1736, 0x9, 0xc0000154b0)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/map_faststr.go:278 +0x220 fp=0xc00008ee10 sp=0xc00008eda8 pc=0x40fff0
unicode.init()
    /home/noner/FOSS/2019ITMAN/go/src/unicode/tables.go:3522 +0x12c7 fp=0xc00008ee70 sp=0xc00008ee10 pc=0x467c97
runtime.doInit(0x549e20)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:5222 +0x8a fp=0xc00008eea0 sp=0xc00008ee70 pc=0x436f2a
runtime.doInit(0x54aec0)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:5217 +0x57 fp=0xc00008eed0 sp=0xc00008eea0 pc=0x436ef7
runtime.doInit(0x54a460)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:5217 +0x57 fp=0xc00008ef00 sp=0xc00008eed0 pc=0x436ef7
runtime.doInit(0x54b7c0)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:5217 +0x57 fp=0xc00008ef30 sp=0xc00008ef00 pc=0x436ef7
runtime.doInit(0x549da0)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:5217 +0x57 fp=0xc00008ef60 sp=0xc00008ef30 pc=0x436ef7
runtime.main()
    /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:190 +0x1da fp=0xc00008efe0 sp=0xc00008ef60 pc=0x42aefa
runtime.goexit()
    /home/noner/FOSS/2019ITMAN/go/src/runtime/asm_amd64.s:1357 +0x1 fp=0xc00008efe8 sp=0xc00008efe0 pc=0x453331
...

$ GODEBUG=allocfreetrace=1 ./hw 2>&1 | grep tracealloc | wc -l
113
$ GODEBUG=allocfreetrace=1 ./hw 2>&1 | grep tracealloc | wc -l
108
$ GODEBUG=allocfreetrace=1 ./hw 2>&1 | grep tracealloc | wc -l
111
$ GODEBUG=allocfreetrace=1 ./hw 2>&1 | grep tracealloc | wc -l
107

```
中間略過很多內容，因為真正的印出訊息量相當龐大。事實上，在筆者的電腦上，直接運行 hellow world 程式的時間約是 2 ms，然而搭配這個印出記憶體紀錄的 debug 選項之後，約是 50 ms 之久。後續的這幾個指令示意，實際上的配置次數與執行時狀態有關，但這樣的 stack trace 也大概有 110 行左右。

> 如果照著這 100 行左右的 bt 看，不就能夠掌握整個 hw 範例的生成過程嗎？也是另外一個切入的角度...

> 有趣的是，在開啟這個選項下執行的 hw 範例雖然有很多 `tracealloc`，但卻一個 `tracefree` 都沒有，應該是因為程式本身很小的緣故？如果是針對 docker 執行檔無參數直接執行，則會看到許多 `tracefree`。再進一步簡單測試發現，docker 指令直接執行大概會經過 45K 道 `tracealloc`，但只會經過 21K+ 道 `tracefree`。

第二個選項 `schedtrace` 用在 hw 上面的話沒有什麼意思，因為都只有一行就結束了。為此，我們需要豪華一點的範例，這裡因為篇幅的因素，就留到下一篇吧！

### 疑問

------------------------------------------------------------------------

- 為什麼 windows 不用相關機制來處理參數？windows 還是可以有命令列程式吧？
- `gostringnocopy` 函式裡面有一些魔幻的手法在轉換結構體與 `string` 型別變數，後面的指標機制怎麼實作？
- 為什麼環境變數的陣列建構時不用 `gostringnocopy`？
- 兩個選項一起設置的話，印出的部份會互相干擾，這難道不是 bug 嗎？

### 本日小結

------------------------------------------------------------------------

## 今日我們瀏覽了 `goargs` 與 `goenvs` 兩個函式是如何處理初始過程的重要資訊，也花了較多篇幅介紹可以輕鬆透過環境變數啟動的除錯模式選項之一。各位讀者，我們明日再會！### 前情提要

`schedinit` 函式終於接近尾聲。昨日追蹤的是與 module、signal 相關的幾項初始化。

### `schedinit`

```go
 ...
    goargs()
    goenvs()
    parsedebugvars()
    ...
```

其餘的部份比較瑣碎，因此 `schedinit` 函式就看到這裡為止吧。

#### `goargs` 函式（在 `runtime/runtime1.go`）

> 不得不說筆者對於 `rintime1`、`runtime2` 這種命名實在極不欣賞，但顯然不可能有十全十美的設計，也許這麼命名也是有緣由的？之後再細究。

```go
func goargs() {
    if GOOS == "windows" {
        return
    }
    argslice = make([]string, argc)
    for i := int32(0); i < argc; i++ {
        argslice[i] = gostringnocopy(argv_index(argv, i))
    }
}
```

windows 系列不需要處理這個部份？為什麼？只是我們使用的 Linux 環境顯然不會進入這個路徑，所以就不理會了。處理命令列參數的 `argslice` 變數先透過 `make` 呼叫作成，然後引用 `argv_index` 這個我們之前也看過的函式來取得每一個參數字串的位址。至於如何不拷貝就建構出這個參數字串的 slice，就要看看 `gostringnocopy` 這個函式怎麼做了：（在 `runtime/string.go`）

```go
func gostringnocopy(str *byte) string {
    ss := stringStruct{str: unsafe.Pointer(str), len: findnull(str)}
    s := *(*string)(unsafe.Pointer(&ss))
    return s
}
```

先是使用傳入的 `byte` 陣列建構 `ss`、型別為 `stringStruct` 的變數，然後之後再用 `unsafe` 的手法取得指標，賦予成真正的 `string` 變數回傳。

#### `goenvs` 函式（`runtime/os_linux.go`）

`goenvs` 函式直接轉手呼叫了下面這個位在 `runtime/runtime1.go` 的函式：

```go
func goenvs_unix() {
    // TODO(austin): ppc64 in dynamic linking mode doesn't
    // guarantee env[] will immediately follow argv. Might cause
    // problems.
    n := int32(0)
    for argv_index(argv, argc+1+n) != nil {
        n++
    }

    envs = make([]string, n)
    for i := int32(0); i < n; i++ {
        envs[i] = gostring(argv_index(argv, argc+1+i))
    }
}
```

這在很之前就曾經看過類似的初始化了！初始化環境變數時，使用到的一個重要假設就是這裡最一開始的 TODO 所提到的**環境變數應該要直接跟在命令列參數後面**。這裡的邏輯與上述類似，但為什麼不用 `gostringnocopy` 的版本？

#### `parsedebugvar` 函式（`runtime/runtime1.go`）

這個函式解析 `GODEBUG` 和 `GOTRACEBACK` 環境變數，並依照指定的參數執行不同的除錯行為。首先第一個檢查的是 `GODEBUG`，透過一個指定初始值與中止條件、但並未指定迴圈前進條件的 for 迴圈：

```go
func parsedebugvars() {
    ...
        for p := gogetenv("GODEBUG"); p != ""; {
                field := ""
                i := index(p, ",")                                                                                                      
                if i < 0 {
                        field, p = p, ""
                } else {
                        field, p = p[:i], p[i+1:]
                }       
                i = index(field, "=")
                if i < 0 {
                        continue
                }      
                key, value := field[:i], field[i+1:]

```
這部份就是純粹的字串處理了。`p` 就是環境變數 `export GODEBUG=...` 的等號之後的一整段字串。由這個處理方式可知，`GODEBUG` 可以非常多功能的處理多組以逗號分隔、以等號賦值的 key-value 設定。至於哪些設定可以被接納呢？不妨參考[這份官方文件](https://golang.org/pkg/runtime/#pkg-overview)的 `Environment Variables` 一節。

筆者這裡挑選其中最簡單易懂的兩個選項出來玩玩看：`allocfreetrace`、`schedtrace`；前者是在每一次的記憶體配置與釋放時印出訊息，後者則是每隔一段時間印出 scheduler 的即時動態。先以以 hello world 程式為例看看前者的效應：

```
$ GODEBUG=allocfreetrace=1 ./hw
...
tracealloc(0xc0000941a0, 0xd0, map.bucket[string]*unicode.RangeTable)
goroutine 1 [running, locked to thread]:
runtime.mallocgc(0xd0, 0x4b0700, 0x1, 0xc000015438)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/malloc.go:1094 +0x4da fp=0xc00008ed48 sp=0xc00008eca8 pc=0x40b0ea
runtime.newobject(...)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/malloc.go:1151
runtime.(*hmap).newoverflow(0xc000092030, 0x4a4b00, 0xc000015320, 0xc0000940d0)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/map.go:262 +0x2b5 fp=0xc00008eda8 sp=0xc00008ed48 pc=0x40c315
runtime.mapassign_faststr(0x4a4b00, 0xc000092030, 0x4c1736, 0x9, 0xc0000154b0)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/map_faststr.go:278 +0x220 fp=0xc00008ee10 sp=0xc00008eda8 pc=0x40fff0
unicode.init()
    /home/noner/FOSS/2019ITMAN/go/src/unicode/tables.go:3522 +0x12c7 fp=0xc00008ee70 sp=0xc00008ee10 pc=0x467c97
runtime.doInit(0x549e20)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:5222 +0x8a fp=0xc00008eea0 sp=0xc00008ee70 pc=0x436f2a
runtime.doInit(0x54aec0)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:5217 +0x57 fp=0xc00008eed0 sp=0xc00008eea0 pc=0x436ef7
runtime.doInit(0x54a460)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:5217 +0x57 fp=0xc00008ef00 sp=0xc00008eed0 pc=0x436ef7
runtime.doInit(0x54b7c0)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:5217 +0x57 fp=0xc00008ef30 sp=0xc00008ef00 pc=0x436ef7
runtime.doInit(0x549da0)
    /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:5217 +0x57 fp=0xc00008ef60 sp=0xc00008ef30 pc=0x436ef7
runtime.main()
    /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:190 +0x1da fp=0xc00008efe0 sp=0xc00008ef60 pc=0x42aefa
runtime.goexit()
    /home/noner/FOSS/2019ITMAN/go/src/runtime/asm_amd64.s:1357 +0x1 fp=0xc00008efe8 sp=0xc00008efe0 pc=0x453331
...

$ GODEBUG=allocfreetrace=1 ./hw 2>&1 | grep tracealloc | wc -l
113
$ GODEBUG=allocfreetrace=1 ./hw 2>&1 | grep tracealloc | wc -l
108
$ GODEBUG=allocfreetrace=1 ./hw 2>&1 | grep tracealloc | wc -l
111
$ GODEBUG=allocfreetrace=1 ./hw 2>&1 | grep tracealloc | wc -l
107

```
中間略過很多內容，因為真正的印出訊息量相當龐大。事實上，在筆者的電腦上，直接運行 hellow world 程式的時間約是 2 ms，然而搭配這個印出記憶體紀錄的 debug 選項之後，約是 50 ms 之久。後續的這幾個指令示意，實際上的配置次數與執行時狀態有關，但這樣的 stack trace 也大概有 110 行左右。

> 如果照著這 100 行左右的 bt 看，不就能夠掌握整個 hw 範例的生成過程嗎？也是另外一個切入的角度...

> 有趣的是，在開啟這個選項下執行的 hw 範例雖然有很多 `tracealloc`，但卻一個 `tracefree` 都沒有，應該是因為程式本身很小的緣故？如果是針對 docker 執行檔無參數直接執行，則會看到許多 `tracefree`。再進一步簡單測試發現，docker 指令直接執行大概會經過 45K 道 `tracealloc`，但只會經過 21K+ 道 `tracefree`。

第二個選項 `schedtrace` 用在 hw 上面的話沒有什麼意思，因為都只有一行就結束了。為此，我們需要豪華一點的範例，這裡因為篇幅的因素，就留到下一篇吧！

### 疑問

------------------------------------------------------------------------

- 為什麼 windows 不用相關機制來處理參數？windows 還是可以有命令列程式吧？
- `gostringnocopy` 函式裡面有一些魔幻的手法在轉換結構體與 `string` 型別變數，後面的指標機制怎麼實作？
- 為什麼環境變數的陣列建構時不用 `gostringnocopy`？
- 兩個選項一起設置的話，印出的部份會互相干擾，這難道不是 bug 嗎？

### 本日小結

------------------------------------------------------------------------

今日我們瀏覽了 `goargs` 與 `goenvs` 兩個函式是如何處理初始過程的重要資訊，也花了較多篇幅介紹可以輕鬆透過環境變數啟動的除錯模式選項之一。各位讀者，我們明日再會！
