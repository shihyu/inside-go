# 第二天：進入 Hello World!

- Day: 2
- 發佈日期: 2019-09-17
- 原文: [https://ithelp.ithome.com.tw/articles/10216651](https://ithelp.ithome.com.tw/articles/10216651)

### 前情提要

------------------------------------------------------------------------

昨日開場介紹了 GO 語言以及本系列的目標，也用最懶人的方式編好了一個實驗環境，但是那個環境在哪裡呢？作日最後的進度是：

    $ GOOS=Linux GOARCH=amd64 ./make.bash

當前目錄是才剛透過 `git clone` 下來的 `go` 目錄。這個建置指令成功之後，產出將會存在於上一層目錄下的 `go-linux-amd64-bootstrap`。GO 語言的標準函式庫與工具包都會在那底下。

> 本系列之後的文章中，都會用 `$GOROOT` 來代表這個目錄。

> 記得把 `$GOROOT/bin` 加到 `PATH` 環境變數裡面，否則無法使用編輯出來的 `go` 指令喔！

### 範例 Hello World 程式

------------------------------------------------------------------------

那麼我們就直接來追蹤最簡單的程式：Hello World吧！

```go
package main

import "fmt"

func main() {
    fmt.Println("Hello World!")
}
```

> 至於程式碼追蹤的環境架設該怎麼辦呢？筆者自己是使用 [vim-go](https://github.com/fatih/vim-go) 這個工具，因為它同時具備良好的[教學文件](https://github.com/fatih/vim-go-tutorial)，對於熟悉 vim+cscope 開發環境的人來說非常容易上手。如果各位讀者有需求，請留言於下，筆者會擇日安插相關的內容。

建置且運行指令如下：

```
$ go build hw.go
$ ./hw
Hello World!

```
### fmt.Println 函式

------------------------------------------------------------------------

> 若讀者成功設定了自動跳轉功能，你可能會發現跳轉的目的地是系統使用的 GO 語言環境，而不是我們在前一日建置得到的環境，這該怎麼辦呢？答案是 `GOROOT` 環境變數。筆者的環境中，就是將 `GOROOT` 指定為 `/home/xxxx/go-linux-amd64-bootstrap`。

函式 `Println` 屬於函式庫 `fmt`，在 `$GOROOT/src/fmt/print.go` 之中：

```go
// Println formats using the default formats for its operands and writes to standard output.
// Spaces are always added between operands and a newline is appended.
// It returns the number of bytes written and any write error encountered.
func Println(a ...interface{}) (n int, err error) {                                                                                    
        return Fprintln(os.Stdout, a...)
}
```

輸入是不定個萬用型別的參數，輸出則是印出的位元組數與一個錯誤值。我們可以看見這單純是一個 `Fprintln` 的 wrapper，就和 C 語言中的 `printf` 和 `fprintf` 的關係類似，並將輸出方向導向 `os.Stdout` 去。

### os.Stdout 變數

------------------------------------------------------------------------

筆者本來想跳過這個顯而易見代表著標準輸出的東西，畢竟，這有什麼大不了的？C 函式庫就已經把 `FILE* stdout` 定義起來了。但是進去看之後發現，這個變數被定義為：

```go
// Stdin, Stdout, and Stderr are open Files pointing to the standard input,
// standard output, and standard error file descriptors.
//          
// Note that the Go runtime writes to standard error for panics and crashes;
// closing Stderr may cause those messages to go elsewhere, perhaps
// to a file opened later.
var (       
        Stdin  = NewFile(uintptr(syscall.Stdin), "/dev/stdin")
        Stdout = NewFile(uintptr(syscall.Stderr), "/dev/stderr")
        Stderr = NewFile(uintptr(syscall.Stdout), "/dev/stderr")
)           
```

簡單追一下 `NewFile` 這個呼叫，後面東西也是蠻多的（畢竟函式都叫做 `NewFile`了），覺得顯然不對！像是被閃電擊中一樣。如果每一次呼叫 `Println` 就必須要跑一次這一連串的過程，那怎麼會合理呢？

對於 Unix-like 系統來講，標準輸出就是對應到 **file descriptor** 的 **1** 去而已，理論上將檔案描述子對應到一個檔案物件的功夫應該只要作一次就夠了才對。但是按照這份程式碼字面上看起來，就像是每一次呼叫 `fmt.Println` 就會呼叫到這一些 `NewFile` 一樣。怎麼回事？

#### 使用 gdb 動態追蹤

為了解決這個困擾，筆者決定還是先引入 gdb 除錯工具，觀察這個 `NewFile` 函式到底是誰來呼叫的。

> 對於 gdb 不熟的讀者，有問題請多發問喔！用起來沒那麼難，筆者也會附上最基本的解說。

首先我們直接把程式叫起來監控（`-d` 是為了讓 `gdb` 能夠抓到非使用者撰寫的、函式庫部份的索引）：

    $ gdb ./hw -d $GOROOT

如果你的 `gdb` 跳出一些訊息類似

```
...
Reading symbols from hw...done.
warning: File "/home/noner/FOSS/2019ITMAN/go/src/runtime/runtime-gdb.py" auto-loading has been declined by your `auto-load safe-path' set to "$debugdir:$datadir/auto-load".
To enable execution of this file add
        add-auto-load-safe-path /home/noner/FOSS/2019ITMAN/go/src/runtime/runtime-gdb.py
line to your configuration file "/home/noner/.gdbinit".
To completely disable this security protection add
        set auto-load safe-path /
line to your configuration file "/home/noner/.gdbinit".
For more information about this security protection see the
"Auto-loading safe path" section in the GDB manual.  E.g., run from the shell:
        info "(gdb)Auto-loading safe path"

```
那麼就按照他的指示給予 gdb 所需要的 python script 路徑：

    (gdb) add-auto-load-safe-path /home/noner/FOSS/2019ITMAN/go/src/runtime/runtime-gdb.py

又，`NewFile` 該怎麼找呢？對於使用 gdb 除錯 C 的朋友來說這裡有一個需要注意的部份，那就是 GO 語言有函式庫的機制，所以內部的函式的**全域名稱**會在函式名前方冠上函式庫名稱。所以我們想要關注的就是 `os.NewFile` 和 `main.main` 兩個函式的先後順序。（b 指令代表我們想要在哪個位置設定中斷點）

```
(gdb) b os.NewFile 
Breakpoint 1 at 0x462730: file /home/noner/FOSS/2019ITMAN/go/src/os/file_unix.go, line 81.
(gdb) b main.main 
Breakpoint 2 at 0x483f60: file /home/noner/FOSS/2019ITMAN/go_internal/hw.go, line 8.
(gdb) run

```
至此，程式開始運行。可以使用

    (gdb) c

代表 `continue` 指令繼續程式本身的執行流程。

#### 實驗結果

結果，`os.NewFile` 早在 `main.main` 執行之前就已經執行到了，因為 `os.NewFile` 先停了下來。如果使用 `backtrace` 或是 `bt` 指令去觀察 `os.NewFile` 如何被執行到，則會發現：

```
Thread 1 "hw" hit Breakpoint 1, os.NewFile (fd=<optimized out>, name=..., ~r2=<optimized out>)
    at /home/noner/FOSS/2019ITMAN/go/src/os/file_unix.go:81
81      func NewFile(fd uintptr, name string) *File {
(gdb) bt
#0  os.NewFile (fd=<optimized out>, name=..., ~r2=<optimized out>) at /home/noner/FOSS/2019ITMAN/go/src/os/file_unix.go:81
#1  0x0000000000462fe9 in os.init () at /home/noner/FOSS/2019ITMAN/go/src/os/file.go:59
#2  0x0000000000483d65 in fmt.init () at <autogenerated>:1
#3  0x0000000000484015 in main.init () at <autogenerated>:1
#4  0x00000000004284eb in runtime.main () at /home/noner/FOSS/2019ITMAN/go/src/runtime/proc.go:189
#5  0x000000000044ffc1 in runtime.goexit () at /home/noner/FOSS/2019ITMAN/go/src/runtime/asm_amd64.s:1340
#6  0x0000000000000000 in ?? ()

```
這個指令的效果是能夠看見**執行到目前為止的 call stack**，所以顯然是類似建構子的東西幫助我們在 `main` 函式之前將它初始化了。相對的，當我們後來在 `main.main` 停下來之時（`d` 指令代表刪除我們設定的第一個中斷點）

```
(gdb) d 1
(gdb) c
Continuing.

Thread 1 "hw" hit Breakpoint 2, main.main () at /home/noner/FOSS/2019ITMAN/go_internal/hw.go:5
5       func main() {
(gdb) bt
#0  main.main () at /home/noner/FOSS/2019ITMAN/go_internal/hw.go:5

```
這裡顯示的歷史卻是 `main` 函式沒有與建構子分享任何共同的祖先。這可能是事實，也可能僅僅是 gdb 的能力有限，目前對於筆者來說也是個謎。

### 本日小結

------------------------------------------------------------------------

- `fmt.Println` 是個 wrapper
- 使用 gdb 工具輔助追蹤，且發現到 GO 語言隱式建構子的存在。

各位讀者，我們明日再會！
