# mdtest Integration Tests

Comprehensive feature testing using mdtest to test itself.

## Setup

```console
$ beforeAll() {
>   export TEST_ROOT="$(mktemp -d)"
>   cd "$TEST_ROOT"
> }
$ afterAll() {
>   rm -rf "$TEST_ROOT"
> }
```

## Basic Command Execution

```console
$ echo "Hello, World!"
Hello, World!
```

## Persistent Environment Variables

```console
$ export MY_VAR="test-value"
$ export ANOTHER="foo"
```

```console
$ echo "$MY_VAR-$ANOTHER"
test-value-foo
```

## Persistent Working Directory

```console
$ mkdir -p subdir/nested
$ cd subdir
$ pwd
{{root:*}}/subdir
```

```console
$ cd nested
$ pwd
{{root}}/subdir/nested
```

## File Operations

```console
$ echo "Hello, mdtest!" > message.txt
$ cat message.txt
Hello, mdtest!
```

## Timestamped Output

```console
$ date +"%Y-%m-%d" > today.txt
$ cat today.txt
/\d{4}-\d{2}-\d{2}/
```

## Named Captures with Wildcard

```console
$ export MY_UUID=$(uuidgen)
$ echo "ID: $MY_UUID"
ID: {{uuid:/[0-9A-Fa-f-]{36}/}}
```

## Reusing Captured Values

```console
$ echo "UUID again: $MY_UUID"
UUID again: {{uuid}}
```

## Regex Matching

```console
$ date +"%Y-%m-%d %H:%M"
/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/
```

## Ellipsis Wildcard Variations

Both `[...]` and `...` work identically as wildcards:

### Ellipsis on separate line (skips 0+ lines) - both forms

```console
$ echo -e "Start\nMiddle\nEnd"
Start
[...]
End
```

```console
$ echo -e "A\nB\nC\nD"
A
...
D
```

### Ellipsis at start and end (matches 0+ lines)

```console
$ ls -1
[...]
message.txt
[...]
```

### Inline wildcard with [...] (matches text on same line)

```console
$ echo "Prefix: some-random-id-12345 Suffix"
Prefix: [...] Suffix
```

### Inline wildcard with ... (matches text on same line)

```console
$ echo "User: $USER, Time: $(date +%s)"
User: ..., Time: ...
```

### Multiple ellipsis on same line (mixed forms)

```console
$ echo "A: value1 B: value2 C: value3"
A: [...] B: ... C: [...]
```

### Ellipsis in brackets (JSON/array - use [...] for clarity)

```console
$ echo '["item1", "item2", "item3"]'
[[...]]
```

## Exit Codes

```console exit=1
$ exit 1
[1]
```

## STDERR Expectations

```console
$ echo "Error!" >&2
! Error!
```

## Helper Functions

```console
$ greet() {
>   echo "Hello, $1!"
> }
$ greet "mdtest"
Hello, mdtest!
```

## Function Persistence

```console
$ greet "World"
Hello, World!
```

## Multi-line Commands

```console
$ echo "Line 1" && \
> echo "Line 2" && \
> echo "Line 3"
Line 1
Line 2
Line 3
```
