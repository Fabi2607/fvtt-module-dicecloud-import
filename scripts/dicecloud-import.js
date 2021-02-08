// Set up the user interface
Hooks.on("renderSidebarTab", async (app, html) => {
    if (app.options.id == "compendium") {
        let button = $("<button class='import-dicecloud'><i class='fas fa-file-import'></i> DiceCloud Import</button>")

        button.click(function () {
            new DiceCloudImporter().render(true);
        });

        html.find(".directory-footer").append(button);
    }
})

// Main module class
class DiceCloudImporter extends Application {
    static get defaultOptions() {
        const options = super.defaultOptions;
        options.id = "dicecloudimporter";
        options.template = "modules/dicecloud-import/templates/dicecloud_import_ui.html"
        options.classes.push("dicecloud-importer");
        options.resizable = false;
        options.height = "auto";
        options.width = 400;
        options.minimizable = true;
        options.title = "DiceCloud Importer"
        return options;
    }

    activateListeners(html) {
        super.activateListeners(html)
        html.find(".import-dicecloud").click(async ev => {
            let dicecloudJSON = html.find('[name=dicecloud-json]').val();
            let updateBool = html.find('[name=updateButton]').is(':checked');
            await DiceCloudImporter.parseCharacter(dicecloudJSON, updateBool)
        });
        this.close();
    }

    static parseAbilities(parsedCharacter) {
        const translations = new Map([
            ["strength", "str"],
            ["dexterity", "dex"],
            ["constitution", "con"],
            ["intelligence", "int"],
            ["wisdom", "wis"],
            ["charisma", "cha"],
        ]);
        const charId = parsedCharacter.character._id
        const effects_by_stat = new Map();
        parsedCharacter.collections.effects
            .filter((effect) => translations.has(effect.stat))
            .forEach((effect) => {
                if (effects_by_stat.has(effect.stat)) {
                    effects_by_stat.get(effect.stat).push(effect);
                } else {
                    effects_by_stat.set(effect.stat, [effect]);
                }
            });
        const abilities = {
            str: {
                proficient: 0,
                value: 10,
            },
            dex: {
                proficient: 0,
                value: 10,
            },
            con: {
                proficient: 0,
                value: 10,
            },
            int: {
                proficient: 0,
                value: 10,
            },
            wis: {
                proficient: 0,
                value: 10,
            },
            cha: {
                proficient: 0,
                value: 10,
            }
        };
        effects_by_stat.forEach((effectList, stat) => {
            effectList.forEach((effect) => {
                if (!effect.enabled) return;
                if (effect.charId !== charId) return;
                switch (effect.operation) {
                    case "base":
                        abilities[translations.get(stat)].value = effect.value;
                        break;
                    case "add":
                        abilities[translations.get(stat)].value += effect.value;
                        break;
                    case "mul":
                        abilities[translations.get(stat)].value *= effect.value;
                        break;
                    case "advantage":
                        abilities[translations.get(stat)].proficient += 1;
                        break;
                    case "disadvantage":
                        abilities[translations.get(stat)].proficient -= 1;
                        break;
                    default:
                        throw new Error(`effect operation "${effect.operation}" not implemented`)
                }
            });
        });
        return abilities;
    }

    static parseAttributes(parsedCharacter) {
        return {
            ac: {
                label: "Armor Class",
                type: "Number",
                value: 15
            },
            death: {
                success: 0,
                failure: 0,
            },
            exhaustion: 0,
            hd: 3,
            hp: {
                value: 23,
                min: 0,
                max: 23,
            },
            init: {
                value: 0,
                bonus: 0,
                mod: 4,
            },
            movement: {
                burrow: 0,
                climb: 20,
                fly: 0,
                hover: false,
                swim: 0,
                units: "ft",
                walk: 30,
            },
            senses: {
                blindsight: 0,
                darkvision: 60,
                special: "",
                tremorsense: 0,
                truesight: 0,
                units: "ft"
            },
            speed: {
                special:  "Burrow 0 ft, Climb 20 ft, Fly 0 ft, Swim 0 ft",
                value: "30 ft",
            },
            spellcasting: "",
            spelldc: 10,
        };
    }

    static parseDetails(parsedCharacter) {
        return {
            alignment: parsedCharacter.character.alignment,
            appearance: "",
            background: parsedCharacter.character.backstory,
            biography: {
                value: parsedCharacter.character.description,
            },
            bond: parsedCharacter.character.bonds,
            flaw: parsedCharacter.character.ideals,
            ideal: parsedCharacter.character.ideals,
            level: parsedCharacter.collections.classes.reduce((v, c) => v + c.level),
            race: parsedCharacter.character.race,
            trait: parsedCharacter.character.personality,
            source: `DiceCloud`,
        };
    }

    static parseCurrency(parsedCharacter) {
        let copper_pieces = parsedCharacter.collections.items.find(i => i.value === 0.01);
        let silver_pieces = parsedCharacter.collections.items.find(i => i.value === 0.1);
        let electrum_pieces = parsedCharacter.collections.items.find(i => i.value === 0.5);
        let gold_pieces = parsedCharacter.collections.items.find(i => i.value === 1);
        let platinum_pieces = parsedCharacter.collections.items.find(i => i.value === 10);

        return {
            cp: copper_pieces.reduce((v, c) => v + c.value),
            ep: electrum_pieces.reduce((v, c) => v + c.value),
            gp: gold_pieces.reduce((v, c) => v + c.value),
            pp: platinum_pieces.reduce((v, c) => v + c.value),
            sp: silver_pieces.reduce((v, c) => v + c.value),
        };
    }

    static parseTraits(parsedCharacter) {
        return {
            size: "med",
            di: {
                value: []
            },
            dr: {
                value: []
            },
            dv: {
                value: []
            },
            ci: {
                value: []
            },
            senses: "",
        };
    }

    static async parseCharacter(characterJSON, updateBool) {
        // Parse CritterDB JSON data pasted in UI
        // Determine if this is a single monster or a bestiary by checking for creatures array
        let parsedCharacter = JSON.parse(characterJSON);
        // console.log(updateBool)

        // Dictionary to map monster size strings
        let size_dict = {
            "Tiny": "tiny",
            "Small": "sm",
            "Medium": "med",
            "Large": "lrg",
            "Huge": "huge",
            "Gargantuan": "grg"
        };

        // Find image if present
        let img_url = "icons/svg/mystery-man.png";

        if (parsedCharacter.character.picture) {
            img_url = parsedCharacter.character.picture;
        }

        // Create the temporary actor data structure
        let tempActor = {
            name: parsedCharacter.character.name,
            type: "character",
            img: img_url,
            token: {
                name: parsedCharacter.character.name,
                img: "icons/svg/mystery-man.png",
            },
            data: {
                abilities: DiceCloudImporter.parseAbilities(parsedCharacter),
                attributes: DiceCloudImporter.parseAttributes(parsedCharacter),
                currency: DiceCloudImporter.parseCurrency(parsedCharacter),
                details: DiceCloudImporter.parseDetails(parsedCharacter),
                traits: DiceCloudImporter.parseTraits(parsedCharacter),
                items: []
            },
            items: [],
        };

        // Create owned "Items" for spells, actions, and abilities
        // WIP: Loop over the critterDB stats.additionalAbilities, actions, reactions, and legendaryActions
        // to generate Foundry "items" for attacks/spells/etc

        console.log(tempActor);

        // Check if this actor already exists and handle update/replacement
        let existingActor = game.actors.find(c => c.name === tempActor.name);

        if (existingActor == null) {
            let thisActor = await Actor.create(tempActor, {'temporary': false, 'displaySheet': false});

            // Wrap up
            console.log(`Done importing ${tempActor.name}`);
            ui.notifications.info(`Done importing ${tempActor.name}`);
        } else if (updateBool == true) {
            // Need to pass _id to updateEntity
            tempActor._id = existingActor._id;

            // Don't update image or token in case these have been modified in Foundry
            // Could make this a check box later?
            delete tempActor.img;
            delete tempActor.token;

            existingActor.update(tempActor);

            console.log(`Updated ${tempActor.name}`);
            ui.notifications.info(`Updated data for ${tempActor.name}`);
        } else {
            console.log(`${tempActor.name} already exists. Skipping`);
            ui.notifications.error(`${tempActor.name} already exists. Skipping`);
        }
    }
}
