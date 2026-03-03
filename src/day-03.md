# 第三天：追蹤 os.Stdout

- Day: 3
- 發佈日期: 2019-09-18
- 原文: [https://ithelp.ithome.com.tw/articles/10216654](https://ithelp.ithome.com.tw/articles/10216654)

### 前情提要

------------------------------------------------------------------------

昨日透過靜態方法（程式碼）與動態方法（gdb 除錯器）雙管齊下，多窺得一些有趣的行為。

### `os.Stdout` 再追蹤

------------------------------------------------------------------------

昨日為了驗證這個變數啟用了 gdb，且發現了建構子的存在。 **建構子如何被呼叫？**這樣的問題的確很有趣，但筆者這裡決定以 `fmt.Println` 的整個功能性為觀察重點，等到結束了之後再回頭追蹤建構子。

```go
var (       
        Stdin  = NewFile(uintptr(syscall.Stdin), "/dev/stdin")
        Stdout = NewFile(uintptr(syscall.Stderr), "/dev/stdout")
        Stderr = NewFile(uintptr(syscall.Stdout), "/dev/stderr")
)           
```

#### `NewFile`

這個 `NewFile` 又是何方神聖？它被定義在 `$GOROOT/src/os/file_unix.go` 裡面：

```go
// NewFile returns a new File with the given file descriptor and
// name. The returned value will be nil if fd is not a valid file
// descriptor. On Unix systems, if the file descriptor is in
// non-blocking mode, NewFile will attempt to return a pollable File
// (one for which the SetDeadline methods work).
func NewFile(fd uintptr, name string) *File {
        kind := kindNewFile
        if nb, err := unix.IsNonblock(int(fd)); err == nil && nb {
                kind = kindNonBlock
        }
        return newFile(fd, name, kind)
}
```

這個函式只關心 `fd` 的性質是否為 **non-blocking**，而這個判斷又是為了了解該檔案描述子是否為**可輪詢（pollable）**的。根據 UNIX 的**一切皆檔案**哲學，可輪詢與否就被藏在檔案這個抽象層之後了。GO 語言有意的突顯這個性質的重要性，也許是因為 GO 語言團隊在設計之初對於網路和非同步事件的意識更強烈的關係？

> 簡單來說，可以用傳統的 `poll()` 系統呼叫去監控的檔案描述子即是可輪詢的。一般的檔案通常不具備或是沒有必要支援這個性質，而透過 `socket()` 系統呼叫取得的網路通訊介面就可以。順帶一題，`bash` 之類的 shell 程式也使用輪詢機制觀察標準輸入的動態。

稍微轉了一手，附加一個 `kind` 代表這個檔案描述子的形式當作參數，傳下去給非全域可存取的 `newFile` 函式。

#### `newFile`

`newFile` 位在同一個檔案之中，

```go
// newFile is like NewFile, but if called from OpenFile or Pipe
// (as passed in the kind parameter) it tries to add the file to
// the runtime poller.
func newFile(fd uintptr, name string, kind newFileKind) *File {
        fdi := int(fd)
        if fdi < 0 { 
                return nil 
        }  
        f := &File{&file{
                pfd: poll.FD{
                        Sysfd:         fdi,
                        IsStream:      true,
                        ZeroReadIsEOF: true,
                },  
                name:        name,
                stdoutOrErr: fdi == 1 || fdi == 2,
        }} 
           
        pollable := kind == kindOpenFile || kind == kindPipe || kind == kindNonBlock
...
```

這裡將一整個 File 結構體設定起來。其中透過強制轉型，將 `fd` 轉為整數之後儲存在 `Sysfd` 成員中，我們可以預期這就是之後透過 `write()` 系統呼叫執行印出動作時所使用的標準輸出檔案描述子，因為在稍早的初始化部份的程式碼中，

```go
        Stdout = NewFile(uintptr(syscall.Stderr), "/dev/stdout")
```

的 `syscall.Stdout` 就是我們熟悉的 `1`，也就是標準輸出。這裡的寫法也是十分符合 GO 語言典範的，因為有垃圾回收機制的緣故，先宣告一個靜態的 File 結構體並依需求將之填滿，然後直接回傳其指標，也不必擔心記憶體管理的問題。

> 中間筆者跳過一段關於作業系統環境的判定，裡面分別針對 FreeBSD 和 Darwin 做特殊處理，這裡就不深入。

#### `File` 結構與 `poll.FD` 結構

`File` 定義在 `src/os/types.go` 之中，

```go
type File struct {
        *file // os specific
}
```

只包含了一個作業系統相依的指標，而這個 `file` 的定義又回到了 `src/os/file_unix.go` 之中，畢竟因為筆者在 Linux 上實驗：

```go
// file is the real representation of *File.
// The extra level of indirection ensures that no clients of os
// can overwrite this data, which could cause the finalizer
// to close the wrong file descriptor.
type file struct { 
        pfd         poll.FD
        name        string
        dirinfo     *dirInfo // nil unless directory being read
        nonblock    bool     // whether we set nonblocking mode
        stdoutOrErr bool     // whether this is stdout or stderr
}
```

> 註解很貼心的說明了為什麼要把 `File` 這個抽象層多定義一個指標。但是這裡又牽涉到 `finalizer` 這個對於 C 母語的筆者來講還沒有了解的概念。

`poll.FD` 結構又是什麼呢？這個名稱代表的是**定義在 `poll` 函式庫的 `FD` 型別**，定義在 `src/internal/poll/fd_unix.go` 中

```go
// FD is a file descriptor. The net and os packages use this type as a
// field of a larger type representing a network connection or OS file.
type FD struct {
...
```

`poll.FD` 的實際成員比 `newFile` 函式使用的部份還要多很多，其中有同步機制需要使用的鎖，以及一些標誌性質用的 flag。單從註解我們可以了解這是**網路**以及**一般檔案**的共用界面。但是要真正了解 `poll` 函式庫的存在意義的話，就必須等到之後再說了。

#### 初始化 `f.pfd`

```go
...
        if err := f.pfd.Init("file", pollable); err != nil {         
                // An error here indicates a failure to register     
                // with the netpoll system. That can happen for      
                // a file descriptor that is not supported by        
                // epoll/kqueue; for example, disk files on          
                // GNU/Linux systems. We assume that any real error  
                // will show up in later I/O.     
        } else if pollable {                      
                // We successfully registered with netpoll, so put   
                // the file into nonblocking mode.
                if err := syscall.SetNonblock(fdi, true); err == nil {
                        f.nonblock = true         
                }                                 
        }      
```

這裡的 `Init` 函式即是初始化 `f` 這個 `File` 物件的 `pfd` 這個 `poll.FD` 物件的函式。若是初始化順利且所處理的檔案描述子具有可輪詢的性質，則會進入 `syscall.SetNonblock` 函式，我們可以在 `src/syscall/exec_unix.go` 中一窺究竟：

```go
func SetNonblock(fd int, nonblocking bool) (err error) { 
        flag, err := fcntl(fd, F_GETFL, 0)
        if err != nil {           
                return err        
        }                         
        if nonblocking {
                flag |= O_NONBLOCK
        } else {                  
                flag &^= O_NONBLOCK
        }
        _, err = fcntl(fd, F_SETFL, flag)
        return err
}
```

其中，`fcntl` 會緊接著執行到真實存在於 Linux 系統的 `fcntl()` 系統呼叫，這裡的格式也與 man 手冊中的

    int fcntl(int fildes, int cmd, ...);

相當類似。而在 `src/syscall/zsyscall_linux_amd64.go` 中，

```go
func fcntl(fd int, cmd int, arg int) (val int, err error) { 
        r0, _, e1 := Syscall(SYS_FCNTL, uintptr(fd), uintptr(cmd), uintptr(arg))
        val = int(r0)
        if e1 != 0 { 
                err = errnoErr(e1)
        }       
        return 
}
```

`Syscall` 呼叫大概類似於 glibc 的 `syscall` wrapper。

#### `newFile `收尾

`newFile` 函式還剩下最後的一行，

```go
...
        runtime.SetFinalizer(f.file, (*file).close)
        return f
}
```

`SetFinalizer` 光是註解就超過六十行，詳細解釋了它的非同步特性。從語意上看來，大致上是要準備解構子的意思，但是這個機制還需要從其他角度進一步探究。

### 疑問

------------------------------------------------------------------------

這是筆者自本日開始的一個新章節，用意是紀錄目前為止觀念上還不清楚的地方。畢竟也是一邊學習一邊準備這個系列，沒有辦法直接解決應該不至於太過分；但也的確有可能直到最後都存在無法回答的問題，到時後再一併整理起來，當作未來的學習方向。

- 所謂的 `netpoll` 系統是指什麼？顯然在創建檔案的時候很重要。
- `runtime.SetFinalizer` 是什麼？在整個 GO 語言 runtime 中扮演何種角色？

### 本日小結

------------------------------------------------------------------------

- 看完 `os.Stdout` 標準輸出的生成
- 初遇 `File` 結構、`FD` 結構

各位讀者，我們明日再會！
