# Roblox Studio MCP для Notion

**Подключите Notion AI к Roblox Studio на своём Windows-ПК.** Агент сможет читать сцену, создавать и редактировать Luau-скрипты, выполнять код и запускать тест игры через MCP.

Каждый пользователь запускает сервер у себя. Для работы должны быть включены ПК, интернет и Roblox Studio с открытым Place. В репозитории находятся исходники; адрес и ключ подключения создаются на вашем ПК при запуске.

## Что умеет

- Читать дерево игры, свойства объектов и исходники скриптов выбранного Place.
- Создавать Script, LocalScript и ModuleScript, редактировать код.
- Создавать объекты и менять сцену через Luau.
- Запускать и останавливать Play, получать Output и снимок viewport.
- Работать в режиме только чтения.

Изменения выполняются внутри Studio. Для отдельных файлов на диске требуется файловое подключение. Это самостоятельная неофициальная интеграция для Notion.

## Требования

- Windows x64, Node.js20 или новее с npm.
- Актуальный Roblox Studio с файлом `%LOCALAPPDATA%\Roblox\mcp.bat`.
- Для HTTPS: официальный [cloudflared](https://github.com/cloudflare/cloudflared/releases) в PATH или `bin/cloudflared.exe` внутри проекта.
- Notion с разрешённым Custom MCP и доступными ответами AI. Официальная справка указывает Business/Enterprise. [Notion MCP](https://www.notion.com/en-gb/help/connect-mcp-servers-to-your-notion-agent).

Дополнительный плагин Roblox не нужен. [Официальный встроенный MCP](https://create.roblox.com/docs/studio/mcp).

## Быстрый старт

1. **Code → Download ZIP**: скачайте этот репозиторий и распакуйте.
2. Установите зависимости командой `npm ci` в папке с `package.json`; cloudflared поместите в PATH или `bin/cloudflared.exe`.
3. Откройте Place в Studio и включите **Assistant → … → Manage MCP Servers → Enable Studio as MCP server**.
4. Запустите `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start.ps1`.
5. В **Notion → Settings → Connections → Custom MCP** вставьте Server URL и Bearer token из появившегося `connection.md`, затем нажмите Connect.

Первый запрос в Notion:

> Через «Roblox Studio — этот ПК» вызови roblox_list_roblox_studios. Покажи открытые Studio с их идентификаторами. Ничего не изменяй.

Затем явно выберите `studio_id` нужного Place. Сервер не выбирает первое открытое окно за вас. Подробные шаги и примеры приведены ниже.

## Установка

Распакуйте проект в свою папку, например `C:\roblox-studio-mcp`. В PowerShell откройте её:

```powershell
npm ci
```

Для HTTPS скачайте cloudflared-windows-amd64.exe из официального релиза. Переименуйте его в cloudflared.exe и поместите в bin/ (либо установите в PATH). Binary не включён в исходники.

## Включение в Studio

1. Откройте Roblox Studio и нужный Place. Сохраните текущую работу.
2. Откройте Assistant.
3. В меню `…` выберите **Manage MCP Servers**.
4. Включите **Enable Studio as MCP server**.

Названия интерфейса могут измениться с обновлением Studio; сверяйте их с официальной инструкцией. Сервер не включает MCP в Studio и не открывает Place за вас.

## Запуск

С публичным HTTPS:

```powershell
& .\start.ps1
```

Если Windows блокирует сценарий после распаковки ZIP, разрешите его только для одного запуска:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

Для остановки используйте аналогичную команду с `stop.ps1`. Системную Execution Policy менять не требуется.

Сценарий запускает помощники в фоне. После регистрации туннеля появляется `connection.md`, где находятся Server URL и отдельный ключ. Если подключение занимает дольше45секунд, проверьте `.runtime/tunnel.log`: помощник может продолжать работу.

Локально без туннеля, для диагностики:

```powershell
npm run start:local
```

Локальный адрес: `http://127.0.0.1:8769/mcp`. Он не доступен облачному Notion напрямую; для Notion используйте HTTPS из connection.md.

Не запускайте локальный и публичный режимы одновременно на одном порту. `npm start` также запускает публичный launcher.

## Подключение Notion

1. **Settings → Connections → Discover → Custom MCP**.
2. MCP server URL: значение с окончанием `/mcp` из connection.md.
3. Name: **Roblox Studio — этот ПК**.
4. Authentication: **Bearer token**.
5. Prefix: **Bearer**.
6. Token: только ключ, без слова Bearer.
7. Нажмите Connect и проверьте Installed. Затем проверьте доступ агенту и сделайте реальный запрос в чате.

OAuth/scopes не нужны. Дополнительные headers не нужны при отдельном Bearer поле. Для изменяющих инструментов оставьте подтверждение каждого запуска в Notion.

Для отдельного Custom Agent нужно его собственное подключение в Settings → Tools & Access. Установка в Installed не доказывает, что агент уже выполняет команды.

## Первые команды

Сначала получите список экземпляров:

> Через «Roblox Studio — этот ПК» вызови roblox_list_roblox_studios и покажи открытые Studio с их идентификаторами. Ничего не изменяй.

Затем укажите нужный studio_id. Мост не выбирает первый найденный Place автоматически.

> В Studio с id «НУЖНЫЙ-ID» через «Roblox Studio — этот ПК» покажи дерево Workspace и прочитай скрипты ServerScriptService. Ничего не изменяй.

Создание объекта:

> В Studio с id «НУЖНЫЙ-ID» создай в Workspace красный Anchored Part размером 4×1×4 и назови его MCP_Test. Существующие объекты не удаляй. Перед выполнением покажи Luau-код.

Создание скрипта:

> В Studio с id «НУЖНЫЙ-ID» создай Script game.ServerScriptService.HelloMCP с кодом print("Привет от MCP"). Используй roblox_multi_edit, datamodel_type Edit, className Script. Сначала прочитай текущий файл, если он уже существует.

Playtest:

> В Studio с id «НУЖНЫЙ-ID» запусти playtest, прочитай Output, затем останови тест. Не публикуй игру.

Сохранение и публикацию Place выполняйте в Studio сами. Мост не добавляет отдельной команды публикации, но произвольный Luau имеет права Studio — это не гарантия запрета публикации через код.

## Инструменты

Публикуются только следующие инструменты официального MCP; внешние имена имеют префикс roblox_. Схемы аргументов получает установленный Studio, поэтому обязательные параметры нужно брать из tools/list.

| Инструмент | Назначение |
|---|---|
| roblox_list_roblox_studios | Список открытых Studio и их id |
| roblox_search_game_tree | Дерево экземпляров |
| roblox_inspect_instance | Свойства и дочерние объекты |
| roblox_script_read | Чтение скрипта |
| roblox_script_search | Поиск скрипта по имени |
| roblox_script_grep | Поиск текста в скриптах |
| roblox_multi_edit | Создание и изменение скриптов |
| roblox_execute_luau | Выполнение Luau |
| roblox_get_studio_state | Состояние и datamodel types |
| roblox_start_stop_play | Запуск/остановка playtest |
| roblox_get_console_output | Журнал Output |
| roblox_screen_capture | Снимок viewport |

Загрузка assets, генераторы и upstream subagent этим подключением не публикуются. Отсутствие инструментов этих имён не является sandbox для execute_luau.

## Режим только чтения

Остановите мост. В `.runtime/config.json` измените только `readOnly` на `true`, сохранив остальные поля. Запустите снова и обновите адрес в Notion, если он изменился.

В этом режиме multi_edit, execute_luau и start_stop_play отсутствуют в tools/list. Остаются9 инструментов чтения/инспекции/viewport. Код принудительно использует allowlist, а не подсказки readOnlyHint от модели. Чтение и viewport всё равно могут раскрыть содержимое выбранного Place агенту.

## Проверка

При работающем локальном/публичном мосте:

```powershell
npm run verify
```

Проверка по текущему публичному адресу:

```powershell
npm run verify -- --public
```

Она проверяет ключ, tools/list и список Studio, не изменяя игру. Отчёт — `.runtime/verification.json`. Если Studio не открыто или MCP выключен, его список будет пустым либо инструмент вернёт явную ошибку. Такой ответ подтверждает протокол, но не управление Place.

Автоматические тесты сервера:

```powershell
npm test
```

Тесты используют mock upstream и настоящие SDK HTTP-запросы. Они проверяют защиту, фильтр инструментов, режим чтения, схему аргументов, изображения и ошибки. Они не имитируют подтверждённое изменение реального Place.

## Остановка

```powershell
& .\stop.ps1
```

MCP закрывается штатно через SDK; туннель отключается. Roblox Studio остаётся открытым. Клавиши Ctrl+C в локальном режиме также вызывают штатную остановку. Удаление подключения в Notion не останавливает сервер на ПК.

## Защита и условия работы

- HTTP слушает только127.0.0.1. Notion использует HTTPS и отдельный Bearer ключ.
- Управляющие /_status и /_shutdown принимают только локальные запросы с ключом; запросы через туннель отклоняются.
- Ключ автоматически создаётся при первом запуске в .runtime/config.json. Ключ и connection.md не публикуются.
- Доступ execute_luau — действия с правами Roblox Studio в выбранном Place. Полная изоляция проекта/пользователя не реализуется.
- ПК, Studio и интернет должны работать; сон ПК прерывает доступ.
- Quick Tunnel временный: после нового запуска меняется домен; обновите URL в Notion. Гарантии доступности нет. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
- Автозагрузка и постоянный домен не настроены.

Если ключ раскрыт, остановите мост, замените token в .runtime/config.json новым32byte случайным hex-ключом, запустите снова и обновите ключ/URL в Notion. Не удаляйте действующую конфигурацию при запущенном сервере.

## Ошибки

| Ошибка | Действие |
|---|---|
| mcp.bat не найден | Обновите Studio и проверьте официальный встроенный MCP. |
| cloudflared не найден | Установите в PATH или bin/cloudflared.exe. |
| Нет открытых Studio | Откройте Place и включите Enable Studio as MCP server. |
| Неверный studio_id | Получите актуальный список, выберите свой экземпляр. |
| 401 | Проверьте ключ, Prefix Bearer и адрес именно этого сервера. |
| 403 | Используйте штатный туннель Hostlocalhost, официальный Notion Origin и /mcp. |
| 503 | Официальный MCP отключился; вызовите stop.ps1, затем start.ps1. Studio не завершается вручную. |
| Новый инструмент не появился | Сервер публикует только фиксированный allowlist. |
| Часть команды не работает в readOnly | Переключите readOnly только если хотите дать права изменения. |
| Notion не выполняет запрос | Проверьте тариф, ответы AI, доступ подключения агенту и подтверждение инструментов. |
| HTTPS ещё недоступен | Дождитесь Registered tunnel connection в .runtime/tunnel.log и проверьте сеть. |

## GitHub

Публикуйте собственный исходный код, README, package.json и package-lock.json. .gitignore исключает node_modules, .runtime, connection.md, binary и файлы Place. Browser Upload files не применяет gitignore: используйте чистый исходный архив или git status перед push.

Встроенный StudioMCP.exe и cloudflared устанавливаются отдельно; они не являются кодом этого проекта. Репозиторий не получает доступ к вашему ПК, ключи и адреса создаются у каждого пользователя локально. Это не официальный продукт Notion или Roblox.

## Проверенный объём

12 автоматических тестов HTTP/MCP проходят с настоящим SDK и тестовым upstream Studio. Также проверены реальные initialize, tools/list и list_roblox_studios через установленный официальный MCP локально и по HTTPS. Создание скриптов, изменение реального Place и Play в Studio не проверялись. Тесты протокола не заменяют проверку вашей игры.

Для ручной оценки агента подготовлены10 независимых вопросов и пример одноразового Place: [evaluations/README.md](evaluations/README.md). Эта оценка не выполнена; ожидаемые ответы выведены из примера, а не из подтверждённого запуска Studio.

Внешние компоненты и их лицензии перечислены в [THIRD_PARTY.md](THIRD_PARTY.md). Бинарники Studio и cloudflared устанавливаются отдельно.
