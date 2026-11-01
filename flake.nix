{
  # The dev environment for agents and people: `nix develop` gives the tools
  # the README and CLAUDE.md assume. Xcode itself is not here — it comes from
  # the machine (xcode-select), because nixpkgs cannot ship it.
  description = "Akashic dev shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAll (pkgs: {
        default = pkgs.mkShellNoCC {
          packages = [
            # CI still pins node 20, which nixpkgs dropped at its end of life
            # (2026-04-30); 22 is the oldest LTS left.
            pkgs.nodejs_22
          ] ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
            # apple/Akashic.xcodeproj is generated, never committed.
            pkgs.xcodegen
          ];
          shellHook = ''
            # nixpkgs' darwin stdenv points DEVELOPER_DIR at its own SDK;
            # xcodebuild must use the Xcode xcode-select names.
            unset DEVELOPER_DIR SDKROOT
          '';
        };
      });
    };
}
