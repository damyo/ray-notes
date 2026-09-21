# Ray Notes

[English](README.md) | [한국어](README.ko.md)

[![GitHub release](https://img.shields.io/github/v/release/damyo/ray-notes)](https://github.com/damyo/ray-notes/releases)
[![Ko-fi에서 후원하기](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/damyo)

Ray Notes는 전용 Obsidian 폴더의 노트를 Raycast Notes에서 영감을 얻은 작고 간결한 별도 창으로 여는 데스크톱 플러그인입니다. Obsidian의 기본 Markdown Editor를 사용하므로 노트는 Vault 안의 일반 Markdown 파일로 유지됩니다.

> Ray Notes는 독립 프로젝트이며 Raycast와 관련이 없습니다.

## 주요 기능

- Obsidian의 ribbon, tab bar, view header, status bar가 없는 간결한 popout
- Raycast에서 영감을 얻은 타이포그래피와 Markdown 스타일의 기본 편집·읽기 모드
- Always on Top, Minimal Mode, 여러 노트 창, 선택 가능한 macOS Show on All Spaces
- 다른 앱에서도 기본 창을 표시하거나 숨길 수 있는 global shortcut
- 제목과 본문을 모두 검색하고 고정 및 최근 열람 순서를 지원하는 Browse Notes
- floating formatting controls, action panel, 노트 내 검색, file properties 지원
- 선택 가능한 반투명 창과 화면 공유 보호
- 첫 번째 의미 있는 줄을 기준으로 제목과 파일명 자동 생성
- 마지막 노트, 창 위치·크기, 최근 열람 상태 복원
- 외부 launcher용 `obsidian://ray-notes` protocol 지원

## 요구 사항

- Obsidian 1.7.2 이상
- 데스크톱 전용

## 설치

### Community plugins

Obsidian Community directory 등록이 완료된 후 다음과 같이 설치할 수 있습니다.

1. **Settings → Community plugins → Browse**를 엽니다.
2. **Ray Notes**를 검색합니다.
3. **Install**을 선택한 다음 **Enable**을 선택합니다.

### 수동 설치

1. 최신 [GitHub release](https://github.com/damyo/ray-notes/releases)에서 `main.js`, `manifest.json`, `styles.css`를 다운로드합니다.
2. 파일을 `<vault>/.obsidian/plugins/ray-notes/`에 넣습니다.
3. Obsidian을 다시 불러오고 **Settings → Community plugins**에서 **Ray Notes**를 활성화합니다.

## 사용법

Command Palette에서 **Ray Notes: Open notes window**를 실행하거나 ribbon icon을 사용합니다. 기본적으로 `Ray Notes` 폴더에 파일을 저장하고 `Option+N`을 global shortcut으로 등록합니다.

macOS 주요 단축키:

| 동작 | 단축키 |
| --- | --- |
| Create Note | `Command+N` |
| Browse Notes | `Command+P` |
| Previous / Next Note | `Command+[` / `Command+]` |
| Find in Note | `Command+F` |
| File Properties | `Command+;` |
| Bold / Italic / Underline | `Command+B` / `Command+I` / `Command+U` |
| Strikethrough | `Shift+Command+S` |
| Inline Code | `Option+Command+E` |
| Heading 1–3 | `Option+Command+1–3` |

Windows의 Mod 단축키에서는 `Command` 대신 `Ctrl`을 사용합니다. Global shortcut은 플러그인 설정에서 변경하거나 비활성화할 수 있습니다.

## 설정

- Notes folder
- 새 창의 기본 Always on Top 상태
- macOS Show on All Spaces
- Global shortcut 및 단축키 기록
- Raycast appearance 및 translucent window
- Ray Notes 폴더의 노트를 여는 위치
- Ray Notes를 열 때 Obsidian 기본 창 최소화 여부

## 지원

오류 및 기능 요청은 [GitHub Issues](https://github.com/damyo/ray-notes/issues)에 등록해 주세요. Ray Notes가 도움이 되었다면 [Ko-fi에서 개발을 후원](https://ko-fi.com/damyo)할 수 있습니다.

## 제한 사항

Ray Notes는 Obsidian 내부에서 실행되므로 Obsidian과 Vault가 열려 있어야 합니다. Obsidian을 종료하면 Ray Notes 창도 함께 종료됩니다.

창 반투명 효과는 Electron의 macOS vibrancy를 사용합니다. Theme이나 다른 플러그인이 불투명 배경을 추가하면 효과가 약해지거나 보이지 않을 수 있습니다.
