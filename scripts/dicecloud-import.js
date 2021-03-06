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
    static abilityTranslations = new Map([
        ["strength", "str"],
        ["dexterity", "dex"],
        ["constitution", "con"],
        ["intelligence", "int"],
        ["wisdom", "wis"],
        ["charisma", "cha"],
    ]);

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

    static abilityLevel(parsedCharacter, effectsByStat, ability) {
        let abilityLevel = 10;
        DiceCloudImporter.applyEffectOperations(parsedCharacter, effectsByStat, ability, (base) => {
            abilityLevel = base;
        }, (changeFunc) => {
            abilityLevel = changeFunc(abilityLevel);
        }, Noop);
        return abilityLevel;
    }

    static abilityModifier(parsedCharacter, effectsByStat, ability) {
        return Math.trunc((this.abilityLevel(parsedCharacter, effectsByStat, ability) - 10) / 2);
    }

    static arbitaryCalculation(parsedCharacter, effectsByStat, calculation) {
        if (calculation === "level * constitutionMod") {
            const constitutionMod = this.abilityModifier(parsedCharacter, effectsByStat, "constitution");
            return DiceCloudImporter.getLevel(parsedCharacter) * constitutionMod;
        } else if (calculation === "dexterityArmor") {
            return 10 + this.abilityModifier(parsedCharacter, effectsByStat, "dexterity");
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
        const charId = parsedCharacter.character._id;
        const abilities = {};
        const proficientAbilities = new Map(parsedCharacter.collections.proficiencies
            .filter((prof) => prof.enabled && prof.charId === charId && prof.type === "save")
            .map((prof) => [prof.name.replace(/Save$/, ""), prof.value]));
        Array.from(this.abilityTranslations.keys()).forEach((stat) => {
            const shortStat = this.abilityTranslations.get(stat);
            abilities[shortStat] = {
                proficient: proficientAbilities.has(stat) ? proficientAbilities.get(stat) : 0,
                value: this.abilityLevel(parsedCharacter, effectsByStat, stat),
            };
        });
        return abilities;
    }

    static parseAttributes(parsedCharacter, effectsByStat) {
        const charId = parsedCharacter.character._id;

        const spellcastingTranslations = new Map(
            ["intelligence", "wisdom", "charisma"]
                .map((ability) => [ability + "Mod", this.abilityTranslations.get(ability)])
        );
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
                darkvision: 0,
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
        if (!text) {
            return "";
        }

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
        const gameEntity = game.items.find(i => i.name.toLowerCase() === name.trim().toLowerCase());

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
            ["Clothes, traveler’s", "Traveler's Clothes"],
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
                        equipped: item.enabled,
                    },
                });
            } else {
                let item_entity = {
                    name: item.name,
                    type: "loot",
                    data: {
                        quantity: item.quantity,
                        description: {
                            value: this.markdownToHTML(item.description)
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
            "Dynamic-Effects-SRD.DAE SRD Midi-collection",
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

            let entity = {}
            if (existing_spell) {
                entity = await actor.createEmbeddedEntity("OwnedItem", existing_spell);
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

                let school = spellSchoolTranslation.has(spell.school) ?
                    spellSchoolTranslation.get(spell.school) : spell.school;

                entity = await actor.createEmbeddedEntity("OwnedItem", {
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
                        school: school,
                        duration: duration,
                        range: range,
                        preparation: {
                            mode: spell.level > 0 ? "prepared" : "always",
                            prepared: spell.prepared === "prepared" || spell.level === 0,
                        },
                        materials: {
                            value: spell.components.material,
                        },
                    },
                    name: spell.name,
                    type: "spell",
                });
            }

            await actor.updateEmbeddedEntity("OwnedItem", {
                _id: entity._id,
                data: {
                    preparation: {
                        mode: spell.level > 0 ? "prepared" : "always",
                        prepared: spell.prepared === "prepared" || spell.level === 0,
                    },
                }
            });
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

            if (feature.name.toLowerCase() === "darkvision") {
                let range = feature.description.split(" ")[0];

                actor.update({
                    data: {
                        attributes: {
                            senses: {
                                darkvision: range,
                            }
                        }
                    }
                })
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

    static parseProficiencies(parsedCharacter, type, known_proficiencies) {
        const proficiencies = parsedCharacter.collections.proficiencies.filter(
            prof => prof.type === type && prof.enabled
        )

        const values = proficiencies.flatMap(prof => prof.name.split(", "));

        const known_values = values.filter(prof => known_proficiencies.has(prof.toLowerCase()));
        const unknown_values = values.filter(prof => !known_proficiencies.has(prof.toLowerCase()));

        const result = {
            selected: {
                custom1: unknown_values.join(", "),
            },
            custom: unknown_values.join(", "),
            value: []
        }

        for (let value of known_values) {
            const known_proficiency = known_proficiencies.get(value.toLowerCase());

            result.value.push(known_proficiency.key);
            result.selected[known_proficiency.key] = known_proficiency.name;
        }

        return result;
    }

    static parseTraits(parsedCharacter) {
        const known_languages = new Map([
            ["aarakocra", {key: "aarakocra", name: "Aarakocra"}],
            ["aquan", {key: "aquan", name: "Aquan"}],
            ["auran", {key: "auran", name: "Auran"}],
            ["thieves' cant", {key: "cant", name: "Thieves' Cant"}],
            ["celestial", {key: "celestial", name: "Celestial"}],
            ["common", {key: "common", name: "Common"}],
            ["deep speech", {key: "deep", name: "Deep Speech"}],
            ["draconic", {key: "draconic", name: "Draconic"}],
            ["druidic", {key: "druidic", name: "Druidic"}],
            ["dwarvish", {key: "dwarvish", name: "Dwarvish"}],
            ["elvish", {key: "elvish", name: "Elvish"}],
            ["giant", {key: "giant", name: "Giant"}],
            ["gith", {key: "gith", name: "Gith"}],
            ["gnoll", {key: "gnoll", name: "Gnoll"}],
            ["gnomish", {key: "gnomish", name: "Gnomish"}],
            ["goblin", {key: "goblin", name: "Goblin"}],
            ["halfling", {key: "halfing", name: "Halfling"}],
            ["ignan", {key: "ignan", name: "Ignan"}],
            ["infernal", {key: "infernal", name: "Infernal"}],
            ["orc", {key: "orc", name: "Orc"}],
            ["primordial", {key: "primordial", name: "Primordial"}],
            ["sylvan", {key: "sylvan", name: "Sylvan"}],
            ["terran", {key: "terran", name: "Terran"}],
            ["undercommon", {key: "undercommon", name: "Undercommon"}],
        ]);

        const known_armor = new Map([
            ["heavy armor", {key: "hvy", name: "Heavy Armor"}],
            ["medium armor", {key: "med", name: "Medium Armor"}],
            ["light armor", {key: "lgt", name: "Light Armor"}],
            ["shields", {key: "shl", name: "Shields"}],
        ]);

        const known_weapons = new Map([
            ["simple weapons", {key: "sim", name: "Simple Weapons"}],
            ["martial weapons", {key: "mar", name: "Martial Weapons"}],
        ]);

        const known_tools = new Map([
            ["artisan's tools", {key: "art", name: "Artisan's Tools"}],
            ["disguise kit", {key: "disg", name: "Disguise Kit"}],
            ["forgery kit", {key: "forg", name: "Forgery Kit"}],
            ["gaming set", {key: "game", name: "Gaming Set"}],
            ["herbalism kit", {key: "herb", name: "Herbalism Kit"}],
            ["musical instrument", {key: "music", name: "Musical Instrument"}],
            ["navigator's tools", {key: "navg", name: "Navigator's Tools"}],
            ["poisoner's kit", {key: "pois", name: "Poisoner's Kit"}],
            ["thieves' tools", {key: "thief", name: "Thieves' Tools"}],
            ["vehicle", {key: "vehicle", name: "Vehicle (Land or Water)"}],
        ]);

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
            languages: this.parseProficiencies(parsedCharacter, "language", known_languages),
            toolProf: this.parseProficiencies(parsedCharacter, "tool", known_tools),
            armorProf: this.parseProficiencies(parsedCharacter, "armor", known_armor),
            weaponProf: this.parseProficiencies(parsedCharacter, "weapon", known_weapons),
        };
    }

    static async parseEmbeddedEntities(actor, parsedCharacter) {
        try {
            await DiceCloudImporter.parseItems(actor, parsedCharacter);
            if (DAE) {
                await DAE.migrateActorItems(actor);
            }
            await DiceCloudImporter.parseLevels(actor, parsedCharacter);
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
                skills: DiceCloudImporter.parseSkills(parsedCharacter),
                items: [],
                effects: [],
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

    static parseSkills(parsedCharacter) {
        const charId = parsedCharacter.character._id;
        const skillTranslations = new Map([
            ["acrobatics", "acr"],
            ["animalHandling", "ani"],
            ["arcana", "arc"],
            ["athletics", "ath"],
            ["deception", "dec"],
            ["history", "his"],
            ["insight", "ins"],
            ["intimidation", "itm"],
            ["investigation", "inv"],
            ["medicine", "med"],
            ["nature", "nat"],
            ["perception", "prc"],
            ["performance", "prf"],
            ["persuasion", "per"],
            ["religion", "rel"],
            ["sleightOfHand", "slt"],
            ["stealth", "ste"],
            ["survival", "sur"],
        ]);
        const skills = {};
        const proficientSkills = new Map(parsedCharacter.collections.proficiencies
            .filter((prof) => prof.enabled && prof.charId === charId && prof.type === "skill")
            .map((prof) => [prof.name, prof.value]));
        Array.from(skillTranslations.keys()).forEach((skill) => {
            const skillObj = parsedCharacter.character[skill];
            if (skillObj == null) {
                console.warn(`skill "${skill}" not found on character`);
                return;
            }
            // not sure if the skill ability really has to be set, but it is defined on both ends
            const skillAbility = skillObj.ability;
            if (skillAbility == null) {
                console.warn(`skill ability for "${skill}" not found on character`);
                return;
            }

            skills[skillTranslations.get(skill)] = {
                value: proficientSkills.has(skill) ? proficientSkills.get(skill) : 0,
                ability: this.abilityTranslations.get(skillAbility),
            };
        });
        return skills;
    }
}
