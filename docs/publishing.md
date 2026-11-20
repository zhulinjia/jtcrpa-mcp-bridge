# 发布到 npm · Publishing to npm

[简体中文](#简体中文) · [English](#english)

## 简体中文

推送与 `package.json` 版本对应的 Git 标签（例如版本 `0.4.2` 对应 `v0.4.2`），会触发 `.github/workflows/publish.yml`。Windows 构建任务安装锁文件中的依赖，运行类型检查、测试并生成 npm 安装包。独立的发布任务取得同一份包，发布后对照 npm 返回的 SHA-512 校验值。重复运行时，如线上已经存在同版本且校验值相同，验证通过即可结束。

首次使用 GitHub Actions 发布**新版本**前，由 npm 包维护者在 `jtcrpa-mcp` 的设置中添加 GitHub Actions 受信发布者，填写仓库所有者、仓库名和工作流文件名 `publish.yml`，并允许 `npm publish`。当前工作流没有指定 GitHub Environment，对应字段留空。也可以在支持 `npm trust` 的 npm CLI 中运行下面的命令并按提示验证。

```powershell
npm.cmd trust github jtcrpa-mcp --repo zhulinjia/jtcrpa-mcp-bridge --file publish.yml --allow-publish --registry=https://registry.npmjs.org
```

在下个版本准备发布时建立信任。npm 要求新绑定在两天内首次成功发布，核对已上线版本的校验值不会验证新绑定。绑定后，工作流使用 GitHub 提供的短期身份完成发布。[npm 可信发布](https://docs.npmjs.com/trusted-publishers/)

## English

Push a Git tag matching the version in `package.json` (for example `v0.4.2` for version `0.4.2`) to trigger `.github/workflows/publish.yml`. The Windows build job installs the locked dependencies, runs type checking and tests, then packs the project. A separate job publishes that archive and verifies the SHA-512 integrity reported by npm. A rerun accepts an existing version only when its integrity matches the built archive.

Before the first **new version** is published from GitHub Actions, an npm package maintainer must add a GitHub Actions trusted publisher in the settings for `jtcrpa-mcp`. Enter the repository owner and name, the filename `publish.yml`, and allow `npm publish`. Leave the GitHub Environment field empty for this workflow. With an npm CLI that supports `npm trust`, you can also run the following and complete the verification prompt.

```powershell
npm.cmd trust github jtcrpa-mcp --repo zhulinjia/jtcrpa-mcp-bridge --file publish.yml --allow-publish --registry=https://registry.npmjs.org
```

Set up trust when the next version is ready. npm requires the first successful publish within two days of creating a trusted publisher. Checking the integrity of an existing release does not validate a new binding. Once bound, the workflow authenticates using the short-lived identity issued by GitHub. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
