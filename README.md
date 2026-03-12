# SBL

수진스가 만든노드.

---

## 🎯 기능

- 배경 폴더 / 캐릭터 폴더 / 장면 폴더 경로 입력
- 노드 안에서 갤러리 형태로 미리보기 (페이지네이션 지원)
- Scene.txt 파일 파싱 → 배경 번호, 캐릭터 번호, 프롬프트 자동 추출
- 캐릭터 2명 이상일 경우 자동으로 가로 합성 후 1장 출력

---

## 📁 폴더 구조

```
sbl/
├── backgrounds/
│   ├── 1.png   (거실)
│   ├── 2.png   (주방)
│   └── 3.png   (외부)
├── characters/
│   ├── 1.png   (여자주인공 캐릭터시트)
│   └── 2.png   (남자주인공 캐릭터시트)
└── scenes/
    ├── Scene1.txt
    ├── Scene2.txt
    └── ...
```

---

## 📝 Scene.txt 형식

```
BACKGROUND: 1
CHARACTERS: 1, 2
PROMPT: 거실에서 여자주인공과 남자주인공이 소파에 앉아 대화하는 장면, 따뜻한 오후 햇살
```

| 키 | 설명 |
|----|------|
| `BACKGROUND` | 사용할 배경 파일 번호 (backgrounds/1.png) |
| `CHARACTERS` | 사용할 캐릭터 번호들, 쉼표로 구분 (2명 이상이면 자동 합성) |
| `PROMPT` | 해당 장면의 이미지 생성 프롬프트 |

---

## ⚙️ 노드 입출력

### Inputs
| Name | Type | 설명 |
|------|------|------|
| `background_folder` | STRING | 배경 이미지 폴더 경로 |
| `character_folder` | STRING | 캐릭터 이미지 폴더 경로 |
| `scene_folder` | STRING | 장면 txt 파일 폴더 경로 |
| `scene_index` | INT | 실행할 장면 번호 (1부터 시작) |

### Outputs
| Name | Type | 설명 |
|------|------|------|
| `background_image` | IMAGE | 배경 이미지 |
| `character_image` | IMAGE | 캐릭터 합성 이미지 |
| `prompt_text` | STRING | 장면 프롬프트 텍스트 |

---

## 🔧 설치 방법

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/YOUR_USERNAME/ssssss
```



---

## 🔗 워크플로우 연결 예시

```
[Seed Generator (increment)]
        ↓ INT
[Sbl]
  ↓ background_image   ↓ character_image   ↓ prompt_text
[Image Edit 노드 등에 연결]
        ↓
[Image Save]
        ↓
[ImpactQueueTrigger] → 자동 반복
```

---


