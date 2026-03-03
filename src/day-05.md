# 第五天：Fprintln 後半

- Day: 5
- 發佈日期: 2019-09-20
- 原文: [https://ithelp.ithome.com.tw/articles/10218227](https://ithelp.ithome.com.tw/articles/10218227)

### 前情提要

------------------------------------------------------------------------

昨日瀏覽了 `fmt.Fprintln` 的前半，先是看了一下 `printer` 代表什麼意義，中間也如往常一般遇到許多新奇又陌生的 GO 語言元件（如 `sync.Pool`），然後觀察到 `p.doPrintln` 函式正式將傳入的參數們化為字串。

### `fmt.Fprintln` 後半

------------------------------------------------------------------------

```go
func Fprintln(w io.Writer, a ...interface{}) (n int, err error) {
        p := newPrinter()
        p.doPrintln(a)
        n, err = w.Write(p.buf)
        p.free()
        return
}
```

追蹤到最後可以發現 `p.buf` 的 `buffer` 型別，其實是從一般的字元陣列 `[]byte` 而來，相關聯的註解表示是為了避免 `bytes.Buffer` 帶來的 overhead。不管怎樣，它會被傳入到 `w` 的 `Write` 函式去。這個又該怎麼找？

由於我們已經知道這裡傳入的 `w` 是之前探討過的 `os.Stdout`，所以我們應該也到 `os` 底下撈撈看有沒有這個函式。果然可以在 `src/os/file.go` 裡面找到一個 `Write`，這裡就請各位讀者相信我，這就是在 `Fprintln` 裡面會使用到的 `Write` 函式。

> 正規來講應該要再開一次 gdb 來觀察，但這裡就先省去那個步驟了。

```go
// Write writes len(b) bytes to the File.
// It returns the number of bytes written and an error, if any.
// Write returns a non-nil error when n != len(b).
func (f *File) Write(b []byte) (n int, err error) {
        if err := f.checkValid("write"); err != nil {
                return 0, err
        }
```

根據註解，這個 `Write` 原型定義沒有什麼新消息，本身是 Unix 系統一直以來的樣貌。最一開始針對 `f` 這個檔案物件執行 `checkValid` 來做檢查。這個函式定義在 `src/os/file_posix.go` 裡面：

```go
// checkValid checks whether f is valid for use.
// If not, it returns an appropriate error, perhaps incorporating the operation name op.
func (f *File) checkValid(op string) error {
        if f == nil {
                return ErrInvalid
        }          
        return nil 
}
```

說實在的，這一段 code 還蠻令人感到傻眼。傳入的 `op` 根本沒有用處，到底是為了什麼？本來想就這樣跳過，但如果連這樣的問題都迴避了，這一系列文大概也不用混了。所以筆者決定觀察一下開發者的紀錄，找出這一段落之所以變成這樣的原因。

但是要怎麼找呢？單純使用 `git blame` 指令無法看見已經消失的程式碼，所以這裡使用額外的一個**指定行數區間**的功能：

```
$ git blame -L 189,+10 src/os/file_posix.go
c05b06a12d0 (Ian Lance Taylor 2017-02-10 15:17:38 -0800 189) func (f *File) checkValid(op string) error {
c05b06a12d0 (Ian Lance Taylor 2017-02-10 15:17:38 -0800 190)    if f == nil {
c05b06a12d0 (Ian Lance Taylor 2017-02-10 15:17:38 -0800 191)            return ErrInvalid
c05b06a12d0 (Ian Lance Taylor 2017-02-10 15:17:38 -0800 192)    }
c05b06a12d0 (Ian Lance Taylor 2017-02-10 15:17:38 -0800 193)    return nil
c05b06a12d0 (Ian Lance Taylor 2017-02-10 15:17:38 -0800 194) }

```
因為筆者撰寫這一系列文之時，`checkValid` 函式在 189 行處，因此設定了**第 189 行開始，十行的範圍內**的 `git blame`。幸好範圍也沒有很大，結果只有一個 commit 與這個區段的修改有關。在這個 commit 裡面，`checkValid` 函式自原本存在的 `src/os/file.go` 裡面刪除掉，而在 `src/os/file_posix.go` 與 `src/os/file_plan9.go` 複製了各自一次。然而，當時的 `checkValid` 函式長成這樣子（節自 `git show` 的輸出結果）：

```go
+func (f *File) checkValid(op string) error {
+       if f == nil {
+               return ErrInvalid
+       }
+       if f.pfd.Sysfd == badFd {
+               return &PathError{op, f.name, ErrClosed}
+       }
+       return nil
+}

```
在第二個段落，也就是 `f` 物件不為空，但是他所存的 `poll.FD` 物件是壞掉的檔案描述子的情況下，回傳了一個特製的錯誤物件。至少，這樣合理多了！因為那個錯誤物件需要使用 `op` 參數。然而這裡有兩個疑點：

- 為什麼現在沒有第二段的判斷區塊？
- 如果途中有修改過，為什麼沒有出現在剛才的指定區段 `git blame` 之中？

兩個問題其實指向同一個答案，因為在這個 commit 時候，這一塊程式碼區段還不在 **189 行起算 10 行**的範圍內，所以沒有出現在剛才的 `blame` 結果之中。參考 `git show c05b06a12d0` 的結果，可以發現這時候這一塊程式碼還在 **144 行起算 29 行**的範圍，因此需要再引用一次 `git blame -L` 追蹤，繁瑣的步驟就略過了，我們發現是在下面這個 commit：

```
commit 11c7b4491bd2cd1deb7b50433f431be9ced330db
Author: Ian Lance Taylor <iant@golang.org>
Date:   Mon Apr 24 21:49:26 2017 -0700

    os: fix race between file I/O and Close
    
    Now that the os package uses internal/poll on Unix and Windows systems,
    it can rely on internal/poll reference counting to ensure that the
    file descriptor is not closed until all I/O is complete
...

```
回顧一下我們原本是在探討 `os.Stdout` 這個檔案物件的 `Write` 成員函式，並且正在觀察它一開始的 `checkValid` 函式。這個 commit 的標題就說明了被拿掉的第二段判斷的理由：現在已經不需要擔心**檔案讀寫**與**關閉**的非同步行為了，這個方面透過 `internal/poll` 函式庫獲得了功能上的保證（在 Unix 上與 Windows 上都是），所以那個部份就不需要再檢查了。

但是為什麼要留著呢？因為 GO 語言想要在 `src/os/file.go` 裡面保留原先的介面，這個介面還正在被 Plan9 使用，我們也可以在 `src/os/file_plan9.go` 裡面看到原先的 `checkValid` 函式實作，所以筆者在 Linux 平台上會使用到的 `file_unix.go` 這邊當然也就不便修改函式之間的 API 了。

#### `write` 函式

```go
        n, e := f.write(b)
        if n < 0 {
                n = 0
        }
        if n != len(b) {
                err = io.ErrShortWrite
        }
```

為什麼又深入一層呢？從大寫變到小寫是在惡作劇嗎？這其實也是抽象層的概念。我們現在身處的 `Write` 函式是所有作業系統都共用的 `file.go`，但是這個小寫的 `write` 是在 `file_unix.go` 之中，

```go
// write writes len(b) bytes to the File.
// It returns the number of bytes written and an error, if any.
func (f *File) write(b []byte) (n int, err error) {
        n, err = f.pfd.Write(b)
        runtime.KeepAlive(f)
        return n, err 
}
```

又再度被導到 `f.pfd` 之前大略觀察過的 `poll.FD` 物件的 `Write` 函式去。不僅如此，在這之後又有一個 `runtime` 函式庫的 `KeepAlive` 功能，顧名思義是為了讓 `f` 不至於被 GO 語言執行期的非同步行為處理掉，而特地強調**這個檔案物件請務必給我留著**的用意；事實上，在這個函式的前後，那些我們都很熟悉的檔案介面操作（`read`、`seek`、...）都有一個 `runtime.KeepAlive` 跟著。

再來看 `f.pfd.Write`，這被定義在 `src/internal/poll/fd_unix.go` 之中，這裡就不列出程式碼，只介紹其中做的事情。

1.  還記得之前觀察 `poll.FD` 物件時層提過他有一些同步鎖的成員變數嗎？其中有一個**寫入鎖**就用在頭尾，保護這個 `Write` 函式的寫入有獨占性。
2.  一個迴圈將傳入的 `b` 透過一個或多個系統呼叫寫到指定的檔案去。是的，就是這裡引用了 `syscall.Write`。但其實這還不是真正的系統呼叫介面，其中還引用了許多 `race` 函式庫的功能保護 `zsyscall_linux_amd64.go` 裡面的 `write` 函式，這個才是系統呼叫介面。
3.  如果偶爾得到來自作業系統的 `EAGAIN` 錯誤訊息，表示可以再次嘗試寫入；這個部份引用到 `poll` 函式庫的部份功能，好讓這個重新嘗試的行為可以不那麼立即發生。
4.  回傳錯誤或者是已經成功寫入的總字元數。

#### `write` 函式收尾

```go
        epipecheck(f, e)
       
        if e != nil {
                err = f.wrapErr("write", e)
        }
       
        return n, err
}
```

`epipecheck` 是一個處理與**管線**以及 `EPIPE` 錯誤管線訊號有關的函式。根據註解，標準輸出也在可能發生這個錯誤的範圍之中，但是這裡就先不深究。若是之前的 `write` 的確回傳了非空的 `e` 錯誤值，那麼

```go
// wrapErr wraps an error that occurred during an operation on an open file.
// It passes io.EOF through unchanged, otherwise converts
// poll.ErrFileClosing to ErrClosed and wraps the error in a PathError.
func (f *File) wrapErr(op string, err error) error {
        if err == nil || err == io.EOF {
                return err 
        }          
        if err == poll.ErrFileClosing {
                err = ErrClosed
        }          
        return &PathError{op, f.name, err}
}
```

將那些錯誤包裝起來，然後回傳。

### 疑問

------------------------------------------------------------------------

- `runtime.KeepAlive` 大致上可以顧名思義。但為什麼它出現在讀寫之後？讀寫之前難道就沒有被 runtime 影響的危險嗎？
- 處理管線錯誤訊號的時候有瞄到 `sigpipe`，GO 語言如何處理 signal？

### 本日小結

------------------------------------------------------------------------

- 介紹並使用 `git blame` 的 `-L` 搜尋區段功能，對於專案的學習力有幫助
- 作為一個多平台通用語言，以寫入功能作為範例簡單窺探到 GO 的抽象層設計
- 看完了 `Fprintln` 函式，看完可以理解的部份

感謝各位讀者，我們明天再會！
