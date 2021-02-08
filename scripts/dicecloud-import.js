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

    static applyEffectOperations(operation, changeValue, changeAdvantage, value) {
        switch (operation) {
            case "base":
                changeValue(() => value)
                break;
            case "add":
                changeValue((previousValue) => previousValue + value)
                break;
            case "mul":
                changeValue((previousValue) => previousValue * value)
                break;
            case "advantage":
                changeAdvantage(+1);
                break;
            case "disadvantage":
                changeAdvantage(-1);
                break;
            default:
                throw new Error(`operation "${operation}" not implemented`)
        }
    }

    static parseAbilities(effects_by_stat) {
        const translations = new Map([
            ["strength", "str"],
            ["dexterity", "dex"],
            ["constitution", "con"],
            ["intelligence", "int"],
            ["wisdom", "wis"],
            ["charisma", "cha"],
        ]);
        const abilities = {};
        Array.from(translations.values()).forEach((shortStat) => {
            abilities[shortStat] = {
                proficient: 0,
                value: 10,
            };
        });
        Array.from(translations.keys()).forEach((stat) => {
            const shortStat = translations.get(stat);
            function changeAbility(changeFunc) {
                abilities[shortStat].value = changeFunc(abilities[shortStat].value);
            }
            effects_by_stat.get(stat)
                .filter((effect) => effect.enabled)
                .forEach((effect) => {
                    this.applyEffectOperations(effect.operation, changeAbility, () => {}, effect.value)
                });
        });
        return abilities;
    }

    static parseAttributes(parsedCharacter) {
        const spellcastingTranslations = new Map([
            ["intelligenceMod", "int"],
            ["wisdomMod", "wis"],
            ["charismaMod", "cha"],
        ]);
        const charId = parsedCharacter.character._id;
        const spellList = parsedCharacter.collections.spellLists.filter((spellList) => spellList.charId === charId)[0];
        let spellcasting = Array.from(spellcastingTranslations.keys());
        spellcasting = spellcasting.filter((value) => spellList.attackBonus.includes(value));
        if (spellcasting.length === 0) {
            throw new Error(`could not determine spellcasting ability from ${spellList.attackBonus}`)
        }
        spellcasting = spellcastingTranslations.get(spellcasting[0]);
        return {
            ac: {
                value: 10,
            },
            death: {
                success: 0,
                failure: 0,
            },
            inspiration: 0,
            exhaustion: 0,
            encumbrance: {
                value: null,
                max: null
            },
            hd: 3,
            hp: {
                value: 23,
                min: 0,
                max: 23,
                temp: 0,
                tempmax: 0,
            },
            init: {
                value: 0,
                bonus: 0,
            },
            movement: {
                burrow: 0,
                climb: 0,
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
            spellcasting,
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
        let copper_pieces = parsedCharacter.collections.items.find(i => i.name === "Copper piece");
        let silver_pieces = parsedCharacter.collections.items.find(i => i.name === "Silver piece");
        let electrum_pieces = parsedCharacter.collections.items.find(i => i.name === "Electrum piece");
        let gold_pieces = parsedCharacter.collections.items.find(i => i.name === "Gold piece");
        let platinum_pieces = parsedCharacter.collections.items.find(i => i.name === "Platinum piece");

        return {
            cp: copper_pieces ? copper_pieces.quantity : 0,
            ep: electrum_pieces ? electrum_pieces.quantity : 0,
            gp: gold_pieces ? gold_pieces.quantity : 0,
            pp: platinum_pieces ? platinum_pieces.quantity : 0,
            sp: silver_pieces ? silver_pieces.quantity : 0,
        };
    }

    static async parseItems(actor, parsedCharacter) {
        let currencyItems = ["Copper piece", "Silver piece", "Electrum piece", "Gold piece", "Platinum piece"];

        const srd_item_name_map = new Map([
            ["Clothes, common", "Common Clothes"],
            ["Clothes, costume", "Costume Clothes"],
            ["Clothes, fine", "Fine Clothes"],
            ["Clothes, traveler's", "Traveler's Clothes"],
            ["Wooden Shield", "Shield"],
            ["Rations (1 day)", "Rations"],
            ["Wooden staff (druidic focus)", "Wooden Staff"],
            ["Paper (one sheet)", "Paper"],
            ["Ink (1 ounce bottle)", "Ink Bottle"],
            ["Rope, hempen (50 feet)", "Hempen Rope (50 ft.)"],
        ]);

        const srd_pack = game.packs.get("dnd5e.items");
        await srd_pack.getIndex();

        let filteredItems = parsedCharacter.collections.items.filter(v => !currencyItems.find(vv => vv === v.name))

        for (let item of filteredItems) {
            let itemName = item.name;
            if (srd_item_name_map.has(itemName)) {
                itemName = srd_item_name_map.get(itemName);
            }

            let srd_item = srd_pack.index.find(value => value.name.toLowerCase() === itemName.toLowerCase());

            if (srd_item) {
                let item_entity = await srd_pack.getEntity(srd_item._id);
                item_entity.data.quantity = item.quantity;
                item_entity.equipped = item.enabled;
                actor.createEmbeddedEntity("OwnedItem", item_entity);
            } else {
                let item_entity = {
                    name: item.name,
                    type: "loot",
                    data: {
                        quantity: item.quantity,
                        description: {
                            value: item.description
                        },
                        equipped: item.enabled,
                        weight: item.weight,
                        value: item.value,
                    }
                };
                actor.createEmbeddedEntity("OwnedItem", item_entity);
            }
        }
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

        const charId = parsedCharacter.character._id
        const effects_by_stat = new Map();
        parsedCharacter.collections.effects
            .filter((effect) => effect.charId === charId)
            .forEach((effect) => {
                if (effects_by_stat.has(effect.stat)) {
                    effects_by_stat.get(effect.stat).push(effect);
                } else {
                    effects_by_stat.set(effect.stat, [effect]);
                }
            });

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
                abilities: DiceCloudImporter.parseAbilities(effects_by_stat),
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

            try {
                await DiceCloudImporter.parseItems(thisActor, parsedCharacter);
            } catch (e) {
                console.error(e);
            }

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

            try {
                const deletions = existingActor.data.items.map(i => i._id);
                existingActor.deleteEmbeddedEntity("OwnedItem", deletions);

                await DiceCloudImporter.parseItems(existingActor, parsedCharacter);
            } catch (e) {
                console.error(e);
            }

            console.log(`Updated ${tempActor.name}`);
            ui.notifications.info(`Updated data for ${tempActor.name}`);
        } else {
            console.log(`${tempActor.name} already exists. Skipping`);
            ui.notifications.error(`${tempActor.name} already exists. Skipping`);
        }
    }
}
