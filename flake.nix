{
description = ''A flake that creates a devShell containing the following:
			- Nixvim (based on nixos-unstable)
            - NodeJS
            - Just (project maintenance/cleanup scripts)
		'';

inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    # nixvim.url = "github:nix-community/nixvim";
    nvim.url = "github:Pleb5/neovim-flake/master";
};

outputs = { nixpkgs, flake-utils, nvim, ... }:

    flake-utils.lib.eachDefaultSystem (system:
        let
            pkgs = nixpkgs.legacyPackages.${system};
            lib = nixpkgs.lib; 
            flotilla_nvim = nvim.packages.${system}.nvim.extend {
                opts = {
                    tabstop = lib.mkForce 2;  # Project-specific settings
                    shiftwidth = lib.mkForce 2;
                };
            };
            
        in {
            devShell = pkgs.mkShell {
                buildInputs = [ 
                    flotilla_nvim
                    pkgs.ripgrep
                    pkgs.nodejs_22
                    pkgs.just
                    pkgs.prettierd
                ];
                shellHook = ''
                    export PATH="$HOME/.cargo/bin:$PATH";
                '';
            };
        }
    );    
}
