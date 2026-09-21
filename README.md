# Ray Notes

Ray Notes는 Obsidian의 기본 `MarkdownView`와 Editor를 그대로 사용하면서, Raycast Notes처럼 작고 간결한 별도 노트 창을 제공하는 데스크톱 전용 플러그인입니다.

## 주요 기능

- 리본, 탭바, view header, status bar가 없는 미니멀 popout
- 항상 위에 표시 및 기본 Obsidian 창 최소화
- 설정한 폴더 안에서만 노트 조회·생성
- 첫 줄을 기준으로 노트 제목과 파일명 자동 생성
- 상단 노트 전환·생성 toolbar와 하단 Markdown formatting toolbar
- 마지막 노트와 창 위치·크기 기억
- `Cmd/Ctrl+P`: 노트 전환
- `Cmd/Ctrl+N`: 새 노트 생성
- `Cmd/Ctrl+[` / `Cmd/Ctrl+]`: 이전·다음 노트 이동
- `obsidian://ray-notes`: Raycast 등 외부 launcher에서 실행

## 개발 및 테스트

Node.js와 `pnpm`이 필요합니다.

```sh
pnpm install
pnpm test
pnpm build
```

빌드 후 아래 파일을 테스트할 Vault에 복사합니다.

```text
<vault>/.obsidian/plugins/ray-notes/
├── main.js
├── manifest.json
└── styles.css
```

Obsidian의 **Settings → Community plugins**에서 **Ray Notes**를 활성화한 다음, Command Palette에서 **Ray Notes: Open notes window**를 실행합니다. 플러그인 파일을 다시 빌드한 경우 Ray Notes를 껐다 켜거나 Obsidian을 다시 로드해야 합니다.

최소 확인 항목:

1. 첫 실행 시 설정 폴더에 노트가 생성되는지 확인합니다.
2. `Cmd/Ctrl+N`으로 만든 노트도 같은 폴더에 저장되는지 확인합니다.
3. 첫 줄을 편집하면 상단 제목과 파일명이 변경되는지 확인합니다.
4. 상·하단 toolbar, 창 드래그, always-on-top 동작을 확인합니다.
5. `obsidian://ray-notes`로 창을 다시 열 수 있는지 확인합니다.

## Obsidian Community plugin 출시

출시 전 [Obsidian Developer policies](https://docs.obsidian.md/Developer+policies)와 [plugin submission guide](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Releasing/Submit%20your%20plugin.md)를 확인합니다.

1. 저장소 루트에 `README.md`, `LICENSE`, `manifest.json`을 준비합니다.
2. `package.json`과 `manifest.json`의 버전을 동일한 Semantic Versioning 형식(`x.y.z`)으로 변경하고 `versions.json`에도 해당 버전을 추가합니다.
3. `pnpm test && pnpm build`를 실행합니다.
4. `manifest.json`의 버전과 동일한 tag로 GitHub Release를 만듭니다.
5. Release asset으로 `main.js`, `manifest.json`, `styles.css`를 각각 첨부합니다.
6. [Obsidian Community directory](https://community.obsidian.md/)에 Obsidian 계정으로 로그인하고 GitHub 계정을 연결한 뒤 저장소를 등록합니다.
7. 자동 검토 결과에 문제가 없다면 plugin directory에 공개됩니다.

최초 등록 이후에는 버전을 올리고 동일한 방식으로 GitHub Release를 게시하면 됩니다. Community directory에 다시 등록할 필요는 없습니다.

## 제한 사항

Ray Notes는 Obsidian 내부에서 실행되므로 Vault와 Obsidian 프로세스가 먼저 실행되어 있어야 합니다. `Cmd+Q`로 Obsidian을 완전히 종료하면 Ray Notes 창도 함께 종료됩니다.
