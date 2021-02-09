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

const Noop = () => undefined;

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

    static arbitaryCalculation(parsedCharacter, effectsByStat, calculation) {
        if (calculation === "level * constitutionMod") {
            let constitution = 10;
            DiceCloudImporter.applyEffectOperations(parsedCharacter, effectsByStat, "constitution", (base) => {
                constitution = base;
            }, (changeFunc) => {
                constitution = changeFunc(constitution);
            }, Noop);
            return DiceCloudImporter.getLevel(parsedCharacter) * Math.trunc((constitution - 10) / 2)
        } else {
            console.warn(`Could not calculate ${calculation}`)
            return 0;
        }
    }

    static applyEffectOperations(parsedCharacter, effectsByStat, stat, baseValue, changeValue, changeAdvantage) {
        function effectValue(effect) {
            if (effect.value != null) {
                return effect.value;
            } else if (effect.calculation != null) {
                return DiceCloudImporter.arbitaryCalculation(parsedCharacter, effectsByStat, effect.calculation);
            } else {
                throw new Error(`could not determine effect value for ${JSON.stringify(effect)}`);
            }
        }

        const effectList = effectsByStat.get(stat).filter((effect) => effect.enabled);
        const baseEffects = effectList.filter((effect) => effect.operation === "base");
        if (baseEffects.length === 0) {
            console.warn(`No base value for effects ${effectList}`);
        } else {
            baseValue(effectValue(baseEffects[baseEffects.length - 1]));
        }

        effectList.forEach((effect) => {
            let value = effectValue(effect);
            switch (effect.operation) {
                case "base":
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
                    throw new Error(`effect operation "${effect.operation}" not implemented`)
            }
        });
    }

    static parseAbilities(parsedCharacter, effectsByStat) {
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
            this.applyEffectOperations(parsedCharacter, effectsByStat, stat, (base) => {
                abilities[shortStat].value = base;
            }, (changeFunc) => {
                abilities[shortStat].value = changeFunc(abilities[shortStat].value);
            }, Noop);
        });

        const charId = parsedCharacter.character._id;
        parsedCharacter.collections.proficiencies
            .filter((prof) => prof.enabled && prof.charId === charId && prof.type === "save")
            .forEach((prof) => {
                const stat = prof.name.replace(/Save$/, "");
                if (translations.has(stat)) {
                    abilities[translations.get(stat)].proficient = prof.value;
                } else {
                    throw new Error(`could not apply proficiency ${JSON.stringify(prof)}`)
                }
            });

        return abilities;
    }

    static parseAttributes(parsedCharacter, effectsByStat) {
        const charId = parsedCharacter.character._id;

        const spellcastingTranslations = new Map([
            ["intelligenceMod", "int"],
            ["wisdomMod", "wis"],
            ["charismaMod", "cha"],
        ]);
        const spellList = parsedCharacter.collections.spellLists.filter((spellList) => spellList.charId === charId)[0];
        let spellcasting = Array.from(spellcastingTranslations.keys());
        spellcasting = spellcasting.filter((value) => spellList.attackBonus.includes(value));
        if (spellcasting.length === 0) {
            throw new Error(`could not determine spellcasting ability from ${spellList.attackBonus}`)
        }
        spellcasting = spellcastingTranslations.get(spellcasting[0]);

        let speed = 30;
        this.applyEffectOperations(parsedCharacter, effectsByStat, "speed", (base) => {
            speed = base;
        }, (changeFunc) => {
            speed = changeFunc(speed);
        }, Noop);

        let armor = 10;
        this.applyEffectOperations(parsedCharacter, effectsByStat, "armor", (base) => {
            armor = base;
        }, (changeFunc) => {
            armor = changeFunc(armor);
        }, Noop)

        const hp = {
            value: 20,
            min: 0,
            max: 20,
        }

        this.applyEffectOperations(parsedCharacter, effectsByStat, "hitPoints", (base) => {
            hp.max = base;
        }, (changeFunc) => {
            hp.max = changeFunc(hp.max);
        }, Noop);
        hp.value = hp.max + parsedCharacter.character.hitPoints.adjustment
        const tempHP = parsedCharacter.collections.temporaryHitPoints
            .filter((tempHP) => tempHP.charId === charId);
        if (tempHP.length !== 0) {
            hp["temp"] = tempHP[0].maximum - tempHP[0].used
            hp["tempmax"] = tempHP[0].maximum
        }

        return {
            ac: {
                value: armor,
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
            hp,
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
                walk: speed,
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
            alignment: this.stripMarkdownLinks(parsedCharacter.character.alignment),
            appearance: "",
            background: this.stripMarkdownLinks(parsedCharacter.character.backstory),
            biography: {
                value: this.markdownToHTML(parsedCharacter.character.description),
            },
            bond: this.markdownToHTML(parsedCharacter.character.bonds),
            flaw: this.markdownToHTML(parsedCharacter.character.flaws),
            ideal: this.markdownToHTML(parsedCharacter.character.ideals),
            level: this.getLevel(parsedCharacter),
            race: this.stripMarkdownLinks(parsedCharacter.character.race),
            trait: this.markdownToHTML(parsedCharacter.character.personality),
            source: `DiceCloud`,
        };
    }

    static stripMarkdownLinks(text) {
        return text.replaceAll(/\[(.+?)\]\(https?:\/\/.+?\)/g, "$1").replace(/^🔗\s*/, "");
    }

    static markdownToHTML(text) {
        return text
            .replaceAll(/\n\s*\n/g, "<br><br>")
            .replaceAll(/\[(.+?)\]\((https?:\/\/.+?)\)/g, "<a href=\"$2\">$1</a>");
    }

    static getLevel(parsedCharacter) {
        return parsedCharacter.collections.classes.reduce((v, c) => v + c.level, 0);
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

    static async prepareCompendiums(compendiums) {
        let prepared_compendiums = compendiums.map(comp => game.packs.get(comp));
        prepared_compendiums = prepared_compendiums.filter(comp => !!comp);

        await Promise.all(
            prepared_compendiums.map(compendium => compendium.getIndex())
        );

        return prepared_compendiums;
    }

    static async findInCompendiums(compendiums, name) {
        const gameEntity = game.items.find(i => i.name === name.trim().toLowerCase());

        if (gameEntity) {
            return gameEntity;
        }

        for (let compendium of compendiums) {
            let item = compendium.index.find(value => value.name.toLowerCase() === name.trim().toLowerCase());

            if (item) {
                return await compendium.getEntity(item._id);
            }
        }

        return null;
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
            ["Oil (flask)", "Oil Flask"],
            ["Case, map or scroll", "Map or Scroll Case"],
            ["Perfume (vial)", "Perfume"],
        ]);

        const ignore_containers = ["Robe of Useful Items"];

        const ignore_container_ids = parsedCharacter.collections.containers.filter(
            v => ignore_containers.includes(v.name)).map(v => v._id);

        const compendiums = await this.prepareCompendiums([
            "Dynamic-Effects-SRD.DAE SRD Items",
            "dnd5e.items",
            `world.ddb-${game.world.name}-items`
        ]);

        let filteredItems = parsedCharacter.collections.items.filter(v => !currencyItems.includes(v.name))

        let items = [];
        for (let item of filteredItems) {
            if (ignore_container_ids.includes(item.parent.id)) {
                continue;
            }

            let itemName = item.name;
            if (srd_item_name_map.has(itemName)) {
                itemName = srd_item_name_map.get(itemName);
            }

            let existing_entity = await this.findInCompendiums(compendiums, itemName);

            if (existing_entity) {
                const entity = await actor.createEmbeddedEntity("OwnedItem", existing_entity);
                await actor.updateEmbeddedEntity("OwnedItem", {
                    _id: entity._id,
                    data: {
                        quantity: item.quantity,
                    },
                    equipped: item.enabled,
                });
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
                items.push(item_entity);
            }
        }
        await actor.createEmbeddedEntity("OwnedItem", items);
    }

    static async parseSpells(actor, parsedCharacter) {
        const compendiums = await this.prepareCompendiums([
            "Dynamic-Effects-SRD.DAE SRD Spells",
            "dnd5e.spells",
            `world.ddb-${game.world.name}-spells`
        ]);

        const spellSchoolTranslation = new Map([
            ["Abjuration", "abj"],
            ["Illusion", "ill"],
            ["Transmutation", "trs"],
            ["Enchantment", "enc"],
            ["Divination", "div"],
            ["Evocation", "evo"],
        ]);

        for (let spell of parsedCharacter.collections.spells) {
            let existing_spell = await this.findInCompendiums(compendiums, spell.name);

            if (existing_spell) {
                await actor.createEmbeddedEntity("OwnedItem", existing_spell);
            } else {
                let range = {};
                if (spell.range.toLowerCase() === "touch") {
                    range = {
                        units: "touch"
                    };
                }

                let duration = {};
                if (spell.duration === "Instantaneous") {
                    duration = {
                        units: "inst",
                    };
                }

                await actor.createEmbeddedEntity("OwnedItem", {
                    data: {
                        level: spell.level,
                        description: {
                            value: spell.description,
                        },
                        components: {
                            vocal: spell.components.verbal,
                            somatic: spell.components.somatic,
                            concentration: spell.components.concentration,
                            ritual: spell.ritual,
                        },
                        duration: duration,
                        range: range,
                        preparation: {
                            prepared: spell.prepared === "prepared",
                        },
                        materials: {
                            value: spell.components.material,
                        },
                    },
                    name: spell.name,
                    type: "spell",
                });
            }
        }
    }

    static async parseLevels(actor, parsedCharacter) {
        const compendiums = await this.prepareCompendiums(["dnd5e.classes"]);

        for (let c_class of parsedCharacter.collections.classes) {
            let srd_item = await this.findInCompendiums(compendiums, c_class.name);

            if (srd_item) {

                let entity = await actor.createEmbeddedEntity("OwnedItem", srd_item);
                await actor.updateEmbeddedEntity("OwnedItem", {
                    _id: entity._id,
                    data: {
                        levels: c_class.level,
                    }
                });
            } else {
                let item_data = {
                    data: {
                        levels: c_class.level,
                    },
                    name: c_class.name,
                    type: "class",
                }
                await actor.createEmbeddedEntity("OwnedItem", item_data);
            }
        }
    }

    static async parseFeatures(actor, parsedCharacter) {
        const compendiums = await this.prepareCompendiums([
            "Dynamic-Effects-SRD.DAE SRD Feats",
            "dnd5e.classfeatures",
            "dnd5e.races",
        ]);

        const ignore_class_features = [
            "Base Ability Scores",
            "Jack of All Trades",
            "Song of Rest",
            "Wild Shape",
        ]

        for (let feature of parsedCharacter.collections.features) {
            if (ignore_class_features.includes(feature.name)) {
                continue;
            }

            let srd_item = await this.findInCompendiums(compendiums, feature.name);

            if (srd_item) {
                await actor.createEmbeddedEntity("OwnedItem", srd_item);
            } else {
                await actor.createEmbeddedEntity("OwnedItem", {
                    type: "feat",
                    name: feature.name,
                    data: {
                        description: {
                            value: feature.description,
                        }
                    }
                });
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

    static async parseEmbeddedEntities(actor, parsedCharacter) {
        try {
            await DiceCloudImporter.parseLevels(actor, parsedCharacter);
            await DiceCloudImporter.parseItems(actor, parsedCharacter);
            await DiceCloudImporter.parseSpells(actor, parsedCharacter);
            await DiceCloudImporter.parseFeatures(actor, parsedCharacter);
        } catch (e) {
            console.error(e);
        }
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
        const effectsByStat = new Map();
        parsedCharacter.collections.effects
            .filter((effect) => effect.charId === charId)
            .forEach((effect) => {
                if (effectsByStat.has(effect.stat)) {
                    effectsByStat.get(effect.stat).push(effect);
                } else {
                    effectsByStat.set(effect.stat, [effect]);
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
                abilities: DiceCloudImporter.parseAbilities(parsedCharacter, effectsByStat),
                attributes: DiceCloudImporter.parseAttributes(parsedCharacter, effectsByStat),
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

            await this.parseEmbeddedEntities(thisActor, parsedCharacter);

            // Wrap up
            console.log(`Done importing ${tempActor.name}`);
            ui.notifications.info(`Done importing ${tempActor.name}`);

        } else if (updateBool) {
            // Need to pass _id to updateEntity
            tempActor._id = existingActor._id;

            // Don't update image or token in case these have been modified in Foundry
            // Could make this a check box later?
            delete tempActor.img;
            delete tempActor.token;

            existingActor.update(tempActor);

            const deletions = existingActor.data.items.map(i => i._id);
            await existingActor.deleteEmbeddedEntity("OwnedItem", deletions);

            await this.parseEmbeddedEntities(existingActor, parsedCharacter);

            console.log(`Updated ${tempActor.name}`);
            ui.notifications.info(`Updated data for ${tempActor.name}`);
        } else {
            console.log(`${tempActor.name} already exists. Skipping`);
            ui.notifications.error(`${tempActor.name} already exists. Skipping`);
        }
    }
}
