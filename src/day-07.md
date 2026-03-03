# 第七天：瀏覽系統相依的初始化

- Day: 7
- 發佈日期: 2019-09-22
- 原文: [https://ithelp.ithome.com.tw/articles/10219216](https://ithelp.ithome.com.tw/articles/10219216)

### 前情提要

------------------------------------------------------------------------

昨日宣告重啟 Hello World 程式，但是是那些我們所寫的 `main` 函式以外的部份。目前追蹤到作業系統與架構相依的部份結束，何時會迎來 GO 語言的通用部份？

### 再次引用 gdb

------------------------------------------------------------------------

既然靜態的程式碼追蹤有點困難，那反正我們也都已經知道一個 GO 程式的切入點在哪裡，那麼不是從那個切入點開始慢慢單步執行就可以了嗎？所以筆者這裡打算使用這個方式，還可以順便透過 gdb 解析的除錯訊息不只了解執行的函式，也要知道那些函式在整個 GO 語言專案中的結構與位置。

那麼就來開啟 gdb 吧。

```
(gdb) b *0x451760
Breakpoint 1 at 0x451760: file /home/alankao/2019Fe/go/src/runtime/rt0_linux_amd64.s, line 8.
(gdb) run
Starting program: /home/alankao/2019Fe/hw 

Breakpoint 1, _rt0_amd64_linux () at /home/alankao/2019Fe/go/src/runtime/rt0_linux_amd64.s:8
8               JMP     _rt0_amd64(SB)
(gdb) s
_rt0_amd64 () at /home/alankao/2019Fe/go/src/runtime/asm_amd64.s:15
15              MOVQ    0(SP), DI       // argc
(gdb)
16              LEAQ    8(SP), SI       // argv
(gdb) 
17              JMP     runtime·rt0_go(SB)
(gdb)

```
是的，這個部份昨天就已經看過，也就是到達 `runtime.rt0_go` 函式之前的過程。其中呼叫前的兩個暫存器操作也一如筆者預期的是程式獲得的來自作業系統的訊息：`argc` 以及 `argv`。

#### `runtime.rt0_go` ...... 對不起，實在是太繁瑣了！

筆者本來想按照順序流水帳的介紹，以達成地毯式的通盤了解，但顯然這樣也是錯誤的抽象層選擇。進入 `runtime.rt0_go` 之後有一些專屬於 Intel 的檢查過程，實在是繁瑣到筆者直接按緊了 enter 鍵（這在 gdb 的使用情境裡代表重複上一個指令，也就是不斷的下一步），片刻之後才突然印出 Hello World 中止。

所以還是鎖定感興趣的部份好了。回到 `src/runtime/asm_amd64.s` 之中，可以閱讀片段的註解來理解那些檢查的區段，但是筆者最感興趣的是以下的幾個呼叫（`CALL` 組語指令），按照順序是

- `runtime.args`
- `runtime.osinit`
- `runtime.schedinit`

這三個顯然是初始化函式？繼續看下去的話：

- `runtime.newproc`：這個呼叫之前似乎有取得 `main` 函式的起始位址。
- `runtime.mstart`：這個開始之後，就啟動了數個 thread，然後印出 Hello World 結束程式了。

之前曾經提過 GO 語言執行檔的 symbol 處理方式是將**函式庫名稱**與**函式名稱**以句點連結起來，但是顯然有些如 `main.init` 這類的就是 GO 在編譯之後生成出來的，從開發者的角度 `main` 函式庫就只有我們提供的 `main` 函式而已。那麼這裡的五個呼叫呢？

這裡的五個呼叫，除了 `osinit` 牽涉到不同的作業系統而有許多函式實體在不同檔案之外，其他的都存在一份於 `runtime` 函式庫中，也就是整個 GO 專案的 `src/runtime` 資料夾底下。我們就來看看吧！

#### `runtime.args`

這個函式顧名思義是要處理傳入的參數，存在於 `src/runtime/runtime1.go` 之中：

```go
func args(c int32, v **byte) {
        argc = c 
        argv = v 
        sysargs(c, v)
}
```

`argc` 與 `argv` 存在於整個 `runtime` 函式庫的命名空間底下，所以理論上應該可以使用 `runtime.argc` 和 `runtime.argv` 之類的方法來存取；**但是實際上不行！**直接玩玩看下面這個範例的話：

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    fmt.Println("Hello World!")
    fmt.Println(runtime.argv)
}
```

在編譯過程中就會報錯：

```
$ go build hw.go
# command-line-arguments
./hw.go:10:14: cannot refer to unexported name runtime.argv
./hw.go:10:14: undefined: runtime.argv

```
也難怪沒有看過這樣子的用法。

`sysargs` 又是什麼樣的函式呢？簡單來說就是**把作業系統給予的空間好好利用出來**的處理過程。作業系統不會只有吝嗇的給**參數數量**與**參數字串陣列**，通常程式還會預期自己能夠透過**環境變數**來判斷所處環境，更進階的用法還有一個**擴增向量（Auxilary Vector，通常簡寫為auxv）**。

> 擴增向量通常都用來作些什麼呢？各位讀者不妨試試看這個指令：`LD_SHOW_AUXV=1 ls`，可以看到 dynamic linker 印出的訊息喔！

總之，這個函式在 `src/runtime/os_linux.go` 裡面：

```go
func sysargs(argc int32, argv **byte) {
    n := argc + 1

    // skip over argv, envp to get to auxv
    for argv_index(argv, n) != nil {
        n++
    }

    // skip NULL separator
    n++

    // now argv+n is auxv
    auxv := (*[1 << 28]uintptr)(add(unsafe.Pointer(argv), uintptr(n)*sys.PtrSize))
    if sysauxv(auxv[:]) != 0 {
        return
    }
    // In some situations we don't get a loader-provided
    // auxv, such as when loaded as a library on Android.
    // Fall back to /proc/self/auxv.
    ...
```

在筆者引用的區段中，可以見到下半都是針對擴增向量的處理；一開始是用 `sysauxv` 去設法撈取 loader 給予的內容，而若沒有取得的話，設法從`/proc/self/auxv` 這個特殊的系統檔案取得。

#### 這些東西長什麼樣子？

一般來說想要偷看記憶體裡面的資訊，只要將之印出來就好。然而，這時候顯然初始化步驟都還沒走完，應該是沒有辦法使用 `fmt` 函式庫的；若要深究這時候可以使用的其他函式庫，看起來只有

```go
import (
    "runtime/internal/sys"
    "unsafe"
)
```

顯然不包含 `fmt`。前者筆者不確定是什麼東西，已經紀錄在疑問章節之中，後者則是在第一個迴圈呼叫的 `argv_index` 小函式裡面以及 `auxv` 變數的生成過程中使用，意指可能不安全的指標存取，也先留待後日研究。

> 光是引用 "fmt" 函式庫就會造成編譯困難，各位讀者可以試試：修改 `src` 資料夾底下的程式碼之後，執行 `./make.bash`。

理論上這裡可以使用 gdb 去看執行相應區塊時的位址內容，也可使用 `print` 函數。相對應的使用方法在 `os_linux.go` 裡面很多，就不細談。

#### `runtime.osinit`

這個函式也在 `src/runtime/os_linux.go` 裡面，內容很單純，

```go
func osinit() {   
        ncpu = getproccount()
}
```

也就是說，為 Linux 做的初始化只需要決定有幾顆 CPU 就好。這個 `getproccount` 函式在同一個檔案內，核心內容是：

```go
...
        var buf [maxCPUs / 8]byte
        r := sched_getaffinity(0, unsafe.Sizeof(buf), &buf[0])
        if r < 0 {
                return 1
        }
        n := int32(0)
        for _, v := range buf[:r] {
                for v != 0 {
                        n += int32(v & 1)
                        v >>= 1
                }
        }
...
    return n
```

這個 `sched_getaffinity` 是 Linux 專有的系統呼叫。第一個參數給定 `0` 的時候，會將當前可用的 CPU 核心透過**遮罩**的方式回傳到這裡的 `buf` 陣列之中。接下來的 for 迴圈也是逐項檢驗內容，並將可用的 CPU 核心數回傳。

### 疑問

------------------------------------------------------------------------

- `import` 關鍵字有時會引用多層結構，為什麼要這樣作？
- 常常看見 `internal` 什麼什麼。**內部的**這個關鍵字的差異是什麼？這些函式庫不都是內部的的嗎？
- `unsafe` 的用途。
- `sched_getaffinity` 並沒有像之前 `write` 那樣最終導到 `Syscall` 去。

### 本日小結

------------------------------------------------------------------------

雖然無法如預期那般流水帳地理解進入點，但也是將作業系統初始化之前的部份看完了；接下來的 `schedinit` 函式將會非常龐大！！！各位讀者，我們明天再會！
