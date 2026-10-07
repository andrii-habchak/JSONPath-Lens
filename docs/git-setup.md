# Git identity and SSH for this repository

This repository is pushed **over SSH** through a host alias, the same way the Vigil project is. The git identity is set **only in this repository's local config**; the global git config is not touched.

## Identity (local to this repo)

| Setting | Value |
| --- | --- |
| `user.name` | `andrii-habchak` |
| `user.email` | `andrey.gabchak@gmail.com` |

Check it:

```bash
git config --local --get user.name    # andrii-habchak
git config --local --get user.email   # andrey.gabchak@gmail.com
```

Set it again (for example in a fresh clone):

```bash
git config --local user.name  "andrii-habchak"
git config --local user.email "andrey.gabchak@gmail.com"
```

Never use `git config --global` for this project: other repositories on this machine use a different identity.

`andrii-habchak <andrey.gabchak@gmail.com>` is the only author and committer of this repository. Commit messages carry no `Co-Authored-By` trailers or other tool attribution.

## Remote (SSH through a host alias)

```bash
git remote -v
# origin  git@github-vigil:andrii-habchak/JSONPath-Lens.git (fetch)
# origin  git@github-vigil:andrii-habchak/JSONPath-Lens.git (push)
```

`github-vigil` is a `Host` alias in `~/.ssh/config` that points to `github.com` and selects the SSH key used for the personal GitHub account (it was created for the Vigil project and is reused here). The plain `git@github.com:` address does **not** work on this machine: the default key is not registered with this account and fails with `Permission denied (publickey)`.

Set the remote in a fresh clone:

```bash
git clone git@github-vigil:andrii-habchak/JSONPath-Lens.git
# or, for an existing checkout
git remote set-url origin git@github-vigil:andrii-habchak/JSONPath-Lens.git
```

Test the connection:

```bash
ssh -T git@github-vigil        # "Hi andrii-habchak! You've successfully authenticated…"
git ls-remote origin           # lists branches without changing anything
```

## Everyday commands

```bash
git switch -c m7-some-feature       # one branch per change / milestone
git add -A
git commit -m "Describe the change"
git push -u origin m7-some-feature  # then open a pull request into main
```

## Optional: a dedicated alias for this repository

If you would rather not share the Vigil alias, give this project its own key and alias:

1. Create a key:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_jsonpath_lens -C "andrey.gabchak@gmail.com"
   ```
2. Add a block to `~/.ssh/config`:
   ```
   Host github-jsonpath-lens
     HostName github.com
     User git
     IdentityFile ~/.ssh/id_ed25519_jsonpath_lens
     IdentitiesOnly yes
     AddKeysToAgent yes
     UseKeychain yes
   ```
3. Register the public key (`~/.ssh/id_ed25519_jsonpath_lens.pub`) on GitHub: either **Settings → SSH and GPG keys** (whole account) or **repository → Settings → Deploy keys** with **Allow write access** (this repository only).
4. Switch the remote and test:
   ```bash
   git remote set-url origin git@github-jsonpath-lens:andrii-habchak/JSONPath-Lens.git
   ssh -T git@github-jsonpath-lens
   ```

## Troubleshooting

| Message | Fix |
| --- | --- |
| `Permission denied (publickey)` | The remote uses `git@github.com:` instead of the alias, or the key is not loaded: run `ssh-add --apple-use-keychain <key file>` and check `ssh -T git@github-vigil`. |
| `ERROR: Permission to … denied to deploy key` | The alias's key is a deploy key of another repository. Use the dedicated alias above. |
| Commits show the wrong author | `git config --local user.email` is unset; set it as shown above. Fix the last commit with `git commit --amend --reset-author --no-edit`. |
| Remote shows `https://github.com/…` | `git remote set-url origin git@github-vigil:andrii-habchak/JSONPath-Lens.git` |
