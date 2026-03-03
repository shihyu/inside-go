# 第十一天：繼續奮戰 schedinit

- Day: 11
- 發佈日期: 2019-09-26
- 原文: [https://ithelp.ithome.com.tw/articles/10221164](https://ithelp.ithome.com.tw/articles/10221164)

### 前情提要

------------------------------------------------------------------------

昨日也追蹤了 `schedinit` 函式的幾個初始化部份。

### `schedinit` ... 今天看完就可以過半了吧

```go
 ...
    alginit()       // maps must not be used before this call
    modulesinit()   // provides activeModules
    typelinksinit() // uses maps, activeModules
    itabsinit()     // uses activeModules

    msigsave(_g_.m)
    initSigmask = _g_.m.sigmask
    ...
```

#### `alginit` 函式（在 `runtime/alg.go`）

這個函式有一些架構相依的判斷，用以決定是否呼叫後續的一個初始化函式 `initAlgAES`。筆者無意深究 AES 的內部實作，但是 GO 語言在這裡似乎是將 [AES](https://zh.wikipedia.org/wiki/%E9%AB%98%E7%BA%A7%E5%8A%A0%E5%AF%86%E6%A0%87%E5%87%86) 本身當作是一種 hash 的手段。

#### `modulesinit` 函式（在 `runtime/symtab.go`）

這邊筆者先翻譯一下註解的部份：

*`moduleinit` 函式從所有的 `module` 當中創造出一個代表 `active module` 的 slice。*  
*一個 module 第一次被動態連結器（dynamic linker）載入時，一個名為 `.init_array` 的函式會被喚醒並呼叫 `addmoduledata`，將當前的 module 加入以 `firstmoduledata` 為首的 linked list 之中。 ...*

也就是說這裡的 module 其實接近 C 裡面的那種 object 的意思吧。且看程式碼：

```go
func modulesinit() {
    modules := new([]*moduledata)
    for md := &firstmoduledata; md != nil; md = md.next {
        if md.bad {
            continue
        }
        *modules = append(*modules, md)
        if md.gcdatamask == (bitvector{}) {
            md.gcdatamask = progToPointerMask((*byte)(unsafe.Pointer(md.gcdata)), md.edata-md.data)
            md.gcbssmask = progToPointerMask((*byte)(unsafe.Pointer(md.gcbss)), md.ebss-md.bss)
        }
    }
    ...
```

果然大致上就是從 `firstmoduledata` 開始逐一掃過每一個 module，然後加入到 `modules` 這個變數之中。後續的 `gc*mask` 操作，就先留在疑問裡面了，筆者猜想這應該是要讓 GC 避開 data 和 bss 區段的意義。

```go
 for i, md := range *modules {
        if md.hasmain != 0 {
            (*modules)[0] = md
            (*modules)[i] = &firstmoduledata
            break
        }
    }
    
    atomicstorep(unsafe.Pointer(&modulesSlice), unsafe.Pointer(modules))
```

這個是因為 modules 這個陣列的順序有意義，因此要把具有 `main` symbol 的 module 提到最前面。最後一行則是將目前為止設置的 `modules` 這個 slice 儲存到 `modulesSlice` 去並全域化，若要取得這整個 slice 只需要呼叫 `activeModules` 函式，

```go
func activeModules() []*moduledata {
    p := (*[]*moduledata)(atomic.Loadp(unsafe.Pointer(&modulesSlice)))
    if p == nil {
        return nil
    }
    return *p
}
```

#### `typelinksinit` 函式（在 `runtime/type.go`）

開頭註解的說明指出這個函式要掃過所有 module 使用到的**型別**，筆者猜想這應該是自定義型別的意思吧？

```go
func typelinksinit() {
    if firstmoduledata.next == nil {
        return
    }
    typehash := make(map[uint32][]*_type, len(firstmoduledata.typelinks))

    modules := activeModules()
    ...
```

我們的範例程式在最一開始的這個判斷就已經回傳了，所以後續我們也就不深究了，畢竟型別系統並不在一開始預定要追蹤的主題中，而且我們的進度已經快要來不及啦！

#### `itabinit` 函式（在 `runtime/iface.go`）

```go
func itabsinit() {
    lock(&itabLock)
    for _, md := range activeModules() {
        for _, i := range md.itablinks {
            itabAdd(i)
        }
    }
    unlock(&itabLock)
}
```

每一個 `md`，也就是 module，都有一個名為 `itablinks` 的成員，這個成員的型別是 `[]*itab`，也就是 `itab` 指標的陣列。`itab` 是一種存放 interface 用的型別，必須被配置在不會被 GC 回收的記憶體中。

#### `msigsave` 函式（同樣在 `runtime/proc.go`）

由於 GO 語言支援其他程式語言的接口，因此其他語言的程式也可以引用 GO 的程式。然而，GO 語言有許多**隱藏設定**，比方說我們一直看到的 `G`、`M` 之類的概念，這些都必須有意識地保存下來才行。關於類 Unix 系統的 signal 機制，也是如此，這個函式就是在保存其他執行期環境呼叫到 GO 程式之時用來儲存原本的 signal mask。

```go
// msigsave saves the current thread's signal mask into mp.sigmask.
// This is used to preserve the non-Go signal mask when a non-Go
// thread calls a Go function.
// This is nosplit and nowritebarrierrec because it is called by needm
// which may be called on a non-Go thread with no g available.
//go:nosplit
//go:nowritebarrierrec
func msigsave(mp *m) {
    sigprocmask(_SIG_SETMASK, nil, &mp.sigmask)
}
```

這個語法也與 sigprocmask 系統呼叫相同，有興趣的讀者可以試試看 `man sigprocmask`：

```
NAME
       sigprocmask, rt_sigprocmask - examine and change blocked signals

SYNOPSIS
       #include <signal.h>

       /* Prototype for the glibc wrapper function */
       int sigprocmask(int how, const sigset_t *set, sigset_t *oldset);
...
       If set is NULL, then the signal mask is unchanged (i.e., how is ignored), but the current value of the signal mask is never‐
       theless returned in oldset (if it is not NULL).
...

```
也就是說，當前的 mask 會被存到 `mp.sigmask` 去，而在回到 `schedinit` 之後，

```go
 initSigmask = _g_.m.sigmask
```

就將之設為初始化的 signal mask。

### 疑問

------------------------------------------------------------------------

- 為什麼 maps 要在 `alginit` 之後才能用？
- atomic 系列函式是如何實作的？
- 常常看到註解內有 `//go:nosplit` 這種實際上類似給編譯器的 hint，運作機制是？

### 本日小結

------------------------------------------------------------------------

明天就要迎來追蹤 `schedinit` 的最後一天啦！真正的目標是 GO 程式的初始化，但是我們就一頭栽入了 runtime 的初始化之中。各位讀者，我們明日再會！
